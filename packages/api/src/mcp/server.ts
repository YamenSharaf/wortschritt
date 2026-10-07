import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  buildImportPrompt,
  cheatsheet,
  createNoteBody,
  exerciseSet,
  importBody,
  saveNoteBody,
  saveVocabBody,
} from "@mdb/shared";
import type { AuthUser } from "../auth/users";
import { builtInIds, loadCheatsheets, loadExerciseSets } from "../content/loader";
import { latestRunsPerSet } from "../services/activity";
import { deleteImport, listImports, saveImport } from "../services/library";
import { createNote, getNote, listNotes, removeNote, updateNote } from "../services/notes";
import { getProgressSummary } from "../services/progress";
import {
  addWordToGroup,
  createGroup,
  deleteGroup,
  getVocab,
  listGroups,
  listVocab,
  ownsGroup,
  removeVocab,
  removeWordFromGroup,
  upsertVocab,
} from "../services/vocab";

/**
 * The MCP server: the app's functionality as tools for AI agents. One server
 * per request, bound to the user behind the API token, so every tool acts as
 * that user — the same per-user rules as the REST API (private vocab, notes
 * and progress; a shared content library where only an item's importer or an
 * admin may replace or delete it).
 *
 * Content tools take the shared Zod schemas as their input schemas, and the
 * authoring guide is the same text the Import page gives LLMs, so an agent
 * sees exactly the format the app validates.
 */

export const INSTRUCTIONS = `mit-dem-baby is a German-learning app. You act as one signed-in user.

- Shared library (every user sees it): exercise sets and cheat sheets. Some are built in (read-only); the rest were imported by users. You can replace or delete only items you imported — an admin can delete anyone's.
- Private to this user: vocabulary (with groups), notes and practice progress.

Writing content: call get_authoring_guide first and follow it exactly — the app validates every set and sheet against its schema and rejects anything malformed. Use validate_content for a dry run, check list_exercise_sets / list_cheatsheets so you don't reuse an id, then save with save_exercise_set or save_cheatsheet. Everything the learner reads is simple German at the set's level.`;

const json = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

/** "items.3.answer.accept: Required" — one line per issue. */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

function guide(kind: "exercise" | "cheatsheet"): string {
  // The Import page's prompt, minus its chat-only ending ("output only JSON",
  // the topic placeholder): here the JSON goes into a tool argument.
  const body = buildImportPrompt(kind)
    .split("\n")
    .filter((line) => !/Output ONLY the JSON|^Topic\b/.test(line))
    .join("\n")
    .trimEnd();
  const tool = kind === "exercise" ? "save_exercise_set (argument `set`)" : "save_cheatsheet (argument `sheet`)";
  return `${body}

Saving: pass the object (not a JSON string) to ${tool}. Saving never replaces an existing id unless you pass overwrite: true, and you can only replace your own imports. Call validate_content first if you are unsure.`;
}

export function createMcpServer(user: AuthUser): McpServer {
  const server = new McpServer(
    { name: "mit-dem-baby", title: "mit dem Baby — German practice", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  const tool = server.registerTool.bind(server);

  /** Who imported what, for the library listings. */
  const owners = () => new Map(listImports(user).map((i) => [i.id, i]));
  const source = (id: string, imports: ReturnType<typeof owners>) => {
    const imp = imports.get(id);
    return imp
      ? { source: "imported" as const, createdBy: imp.createdBy, canDelete: imp.canDelete }
      : { source: "built-in" as const, createdBy: null, canDelete: false };
  };

  // --- account ---------------------------------------------------------------
  tool(
    "whoami",
    { title: "Who am I", description: "The user this connection acts as, and their role (user or admin).", annotations: READ },
    async () => json({ username: user.username, role: user.role }),
  );

  // --- library: reading ------------------------------------------------------
  tool(
    "get_authoring_guide",
    {
      title: "Content format guide",
      description:
        "The exact JSON format for exercise sets or cheat sheets: a complete valid example, every item type, and the rules the app checks. Read it before creating or editing content.",
      inputSchema: { kind: z.enum(["exercise", "cheatsheet"]) },
      annotations: READ,
    },
    async ({ kind }) => ({ content: [{ type: "text", text: guide(kind) }] }),
  );

  tool(
    "list_exercise_sets",
    {
      title: "List exercise sets",
      description:
        "The shared exercise library, newest first: id, title, level, tags, item count and types, and whether it's built in or imported (and by whom). Use get_exercise_set for the items.",
      inputSchema: {
        level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
        tag: z.string().optional().describe("Only sets with this tag"),
      },
      annotations: READ,
    },
    async ({ level, tag }) => {
      const imports = owners();
      return json(
        loadExerciseSets()
          .filter((s) => (!level || s.level === level) && (!tag || s.tags.includes(tag)))
          .map((s) => ({
            id: s.id,
            title: s.title,
            subtitle: s.subtitle,
            level: s.level,
            tags: s.tags,
            items: s.items.length,
            itemTypes: [...new Set(s.items.map((i) => i.type))],
            createdAt: s.createdAt,
            ...source(s.id, imports),
          })),
      );
    },
  );

  tool(
    "get_exercise_set",
    {
      title: "Get an exercise set",
      description: "One exercise set with all its items, in the import format (so it can be edited and saved back).",
      inputSchema: { id: z.string().min(1) },
      annotations: READ,
    },
    async ({ id }) => {
      const set = loadExerciseSets().find((s) => s.id === id);
      return set ? json(set) : fail(`No exercise set "${id}". Use list_exercise_sets to see the ids.`);
    },
  );

  tool(
    "list_cheatsheets",
    {
      title: "List cheat sheets",
      description: "The shared cheat sheets, newest first: id, title, category, section headings, and built-in or imported.",
      annotations: READ,
    },
    async () => {
      const imports = owners();
      return json(
        loadCheatsheets().map((s) => ({
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          category: s.category,
          sections: s.sections.map((x) => x.heading),
          createdAt: s.createdAt,
          ...source(s.id, imports),
        })),
      );
    },
  );

  tool(
    "get_cheatsheet",
    {
      title: "Get a cheat sheet",
      description: "One cheat sheet with its Markdown sections, in the import format.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ,
    },
    async ({ id }) => {
      const sheet = loadCheatsheets().find((s) => s.id === id);
      return sheet ? json(sheet) : fail(`No cheat sheet "${id}". Use list_cheatsheets to see the ids.`);
    },
  );

  // --- library: writing ------------------------------------------------------
  tool(
    "validate_content",
    {
      title: "Validate content (dry run)",
      description:
        "Check an exercise set or cheat sheet against the app's schema without saving it. Returns every problem with its path (e.g. items.3.answer.accept), and whether saving its id would be allowed.",
      inputSchema: {
        kind: z.enum(["exercise", "cheatsheet"]),
        data: z.unknown().describe("The exercise set or cheat sheet object"),
      },
      annotations: READ,
    },
    async ({ kind, data }) => {
      const parsed = importBody.safeParse({ kind, data });
      if (!parsed.success) {
        return json({ valid: false, errors: formatIssues(parsed.error).map((e) => e.replace(/^data\.?/, "") || "(root)") });
      }
      const id = parsed.data.data.id;
      const existing = listImports(user).find((i) => i.id === id);
      let id_status: string;
      if (existing) {
        id_status = existing.canDelete
          ? `"${id}" exists (${existing.createdBy === user.username ? "your import" : `imported by ${existing.createdBy ?? "a deleted user"}`}); saving needs overwrite: true`
          : `"${id}" was imported by someone else; choose a different id`;
      } else if (builtInIds(kind).has(id)) {
        id_status =
          user.role === "admin"
            ? `"${id}" is built in; saving would shadow the built-in version`
            : `"${id}" is built-in content; choose a different id`;
      } else {
        id_status = `"${id}" is free`;
      }
      return json({ valid: true, id, id_status });
    },
  );

  tool(
    "save_exercise_set",
    {
      title: "Save an exercise set",
      description:
        "Add an exercise set to the shared library (validated against the schema). Read get_authoring_guide first. Fails if the id exists unless overwrite is true; you can only replace your own imports (admins: any).",
      inputSchema: {
        set: exerciseSet,
        overwrite: z.boolean().default(false).describe("Replace an existing import with the same id"),
      },
      annotations: WRITE,
    },
    async ({ set, overwrite }) => {
      const res = saveImport(user, { kind: "exercise", data: set }, { overwrite });
      return res.ok ? json({ saved: res.id, replaced: res.replaced, items: set.items.length }) : fail(res.error);
    },
  );

  tool(
    "save_cheatsheet",
    {
      title: "Save a cheat sheet",
      description:
        "Add a cheat sheet to the shared library (validated against the schema). Read get_authoring_guide first. Fails if the id exists unless overwrite is true; you can only replace your own imports (admins: any).",
      inputSchema: {
        sheet: cheatsheet,
        overwrite: z.boolean().default(false).describe("Replace an existing import with the same id"),
      },
      annotations: WRITE,
    },
    async ({ sheet, overwrite }) => {
      const res = saveImport(user, { kind: "cheatsheet", data: sheet }, { overwrite });
      return res.ok ? json({ saved: res.id, replaced: res.replaced }) : fail(res.error);
    },
  );

  tool(
    "delete_content",
    {
      title: "Delete imported content",
      description:
        "Remove an imported exercise set or cheat sheet from the shared library, for everyone. Only its importer or an admin may; built-in items can't be deleted. Learners' past results stay in their history.",
      inputSchema: { id: z.string().min(1) },
      annotations: DELETE,
    },
    async ({ id }) => {
      const res = deleteImport(user, id);
      if (res.ok) return json({ deleted: id });
      if (res.status === 404 && (builtInIds("exercise").has(id) || builtInIds("cheatsheet").has(id))) {
        return fail(`"${id}" is built-in content and can't be deleted`);
      }
      return fail(res.error);
    },
  );

  // --- vocabulary (private) --------------------------------------------------
  tool(
    "list_vocab",
    {
      title: "List saved words",
      description: "This user's saved vocabulary: word, translation, examples, groups, forms and flashcard stats.",
      inputSchema: { group_id: z.number().int().optional().describe("Only words in this group") },
      annotations: READ,
    },
    async ({ group_id }) =>
      json(listVocab(user.id).filter((w) => group_id === undefined || w.groups.includes(group_id))),
  );

  tool(
    "get_vocab",
    {
      title: "Get a saved word",
      description: "One saved word (case-insensitive), or null if it isn't saved.",
      inputSchema: { word: z.string().min(1) },
      annotations: READ,
    },
    async ({ word }) => json(getVocab(user.id, word)),
  );

  tool(
    "save_vocab",
    {
      title: "Save a word",
      description:
        'Add or update a word in this user\'s vocabulary (keyed case-insensitively by "word"). Save the dictionary base form: infinitive for verbs, nominative singular for nouns. "display" is how it\'s shown, e.g. "das Haus"; "translation" is English; examples are short German sentences with an English translation.',
      inputSchema: saveVocabBody.shape,
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (body) => json(upsertVocab(user.id, body)),
  );

  tool(
    "delete_vocab",
    {
      title: "Delete a saved word",
      description: "Remove a word from this user's vocabulary (and its groups and flashcard stats).",
      inputSchema: { word: z.string().min(1) },
      annotations: DELETE,
    },
    async ({ word }) => {
      if (!getVocab(user.id, word)) return fail(`"${word}" isn't saved`);
      removeVocab(user.id, word);
      return json({ deleted: word });
    },
  );

  tool(
    "list_vocab_groups",
    { title: "List word groups", description: "This user's vocabulary groups with their word counts.", annotations: READ },
    async () => json(listGroups(user.id)),
  );

  tool(
    "create_vocab_group",
    {
      title: "Create a word group",
      description: "Create a vocabulary group (e.g. a topic like \"Küche\"). Returns its id.",
      inputSchema: { name: z.string().min(1).max(60) },
      annotations: WRITE,
    },
    async ({ name }) => json(createGroup(user.id, name)),
  );

  tool(
    "delete_vocab_group",
    {
      title: "Delete a word group",
      description: "Delete a vocabulary group. The words themselves stay saved.",
      inputSchema: { group_id: z.number().int() },
      annotations: DELETE,
    },
    async ({ group_id }) => {
      if (!ownsGroup(user.id, group_id)) return fail(`No group ${group_id}. Use list_vocab_groups.`);
      deleteGroup(user.id, group_id);
      return json({ deleted: group_id });
    },
  );

  tool(
    "add_words_to_group",
    {
      title: "Add words to a group",
      description: "Add saved words to a vocabulary group. Save words with save_vocab first; unknown words are reported, not added.",
      inputSchema: { group_id: z.number().int(), words: z.array(z.string().min(1).max(80)).min(1) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ group_id, words }) => {
      if (!ownsGroup(user.id, group_id)) return fail(`No group ${group_id}. Use list_vocab_groups.`);
      const added: string[] = [];
      const notSaved: string[] = [];
      for (const word of words) {
        if (getVocab(user.id, word)) {
          addWordToGroup(user.id, group_id, word);
          added.push(word);
        } else notSaved.push(word);
      }
      return json({ added, notSaved });
    },
  );

  tool(
    "remove_word_from_group",
    {
      title: "Remove a word from a group",
      description: "Take a word out of a vocabulary group (the word stays saved).",
      inputSchema: { group_id: z.number().int(), word: z.string().min(1) },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ group_id, word }) => {
      if (!ownsGroup(user.id, group_id)) return fail(`No group ${group_id}. Use list_vocab_groups.`);
      removeWordFromGroup(user.id, group_id, word);
      return json({ removed: word, group_id });
    },
  );

  // --- notes (private) -------------------------------------------------------
  tool(
    "list_notes",
    {
      title: "List notes",
      description: "This user's notes (Markdown), newest first.",
      inputSchema: { category: z.string().optional().describe("Only notes in this category") },
      annotations: READ,
    },
    async ({ category }) => json(listNotes(user.id).filter((n) => category === undefined || n.category === category)),
  );

  tool(
    "get_note",
    { title: "Get a note", description: "One note by id.", inputSchema: { id: z.string().min(1) }, annotations: READ },
    async ({ id }) => {
      const note = getNote(user.id, id);
      return note ? json(note) : fail(`No note "${id}". Use list_notes.`);
    },
  );

  tool(
    "create_note",
    {
      title: "Create a note",
      description: "Create a note for this user. The body is Markdown; category is a free-form label.",
      inputSchema: createNoteBody.shape,
      annotations: WRITE,
    },
    async (body) => json(createNote(user.id, body)),
  );

  tool(
    "update_note",
    {
      title: "Update a note",
      description: "Change a note's title, category and/or body; fields left out stay as they are. The body is replaced, not appended to.",
      inputSchema: { id: z.string().min(1), ...saveNoteBody.shape },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ id, ...body }) => {
      const note = updateNote(user.id, id, body);
      return note ? json(note) : fail(`No note "${id}". Use list_notes.`);
    },
  );

  tool(
    "delete_note",
    { title: "Delete a note", description: "Delete one of this user's notes.", inputSchema: { id: z.string().min(1) }, annotations: DELETE },
    async ({ id }) => {
      if (!getNote(user.id, id)) return fail(`No note "${id}". Use list_notes.`);
      removeNote(user.id, id);
      return json({ deleted: id });
    },
  );

  // --- progress (private, read-only) -----------------------------------------
  tool(
    "get_progress",
    {
      title: "Practice progress",
      description:
        "This user's practice stats: answers overall and today vs. the daily goal, per-set totals, and the latest run of each recently practised set. Useful for picking what to practise or generate next.",
      annotations: READ,
    },
    async () => json({ ...getProgressSummary(user.id), recentRuns: latestRunsPerSet(user.id, 20) }),
  );

  return server;
}

import { useRef, useState } from "react";
import type { NoteAttachment } from "@mdb/shared";
import { attachmentKind, formatBytes } from "@mdb/client";
import { api } from "../lib/api";
import {
  DownloadIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  PaperclipIcon,
  TrashIcon,
} from "./icons";
import { btn } from "./ui";

const KIND_ICON = { text: FileTextIcon, image: FileImageIcon, audio: FileAudioIcon, pdf: FileTextIcon, file: FileIcon };

/** Files kept with a note: attach (button or drop), open, download, delete. */
export function NoteAttachments({
  attachments,
  attaching,
  onAttach,
  onRemove,
}: {
  attachments: NoteAttachment[];
  attaching: number;
  onAttach: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section
      aria-label="Attachments"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) onAttach([...e.dataTransfer.files]);
      }}
      className={`mt-4 rounded-card border p-3 ${dragging ? "border-focus bg-surface-sunken" : "border-line"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-muted">
          Attachments{attachments.length > 0 && <span className="font-normal"> · {attachments.length}</span>}
        </h2>
        <button type="button" onClick={() => input.current?.click()} className={`${btn.secondary} ${btn.sm}`}>
          <PaperclipIcon className="h-4 w-4" />
          {attaching > 0 ? "Attaching…" : "Attach files"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onAttach(files);
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="mt-2 text-xs text-ink-subtle">
          Keep files with this note — a class transcript, a photo of the board, a PDF, a recording. Drop them here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentRow({ attachment: a, onRemove }: { attachment: NoteAttachment; onRemove: () => void }) {
  const kind = attachmentKind(a.type);
  const Icon = KIND_ICON[kind];
  const url = api.attachmentUrl(a.id);
  return (
    <li className="flex items-center gap-3 py-2">
      {kind === "image" ? (
        <img src={url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-control border border-line object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-ink-muted">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm font-medium">{a.name}</span>
        <span className="block text-xs text-ink-subtle">
          {formatBytes(a.size)} · {new Date(a.createdAt * 1000).toLocaleDateString()}
        </span>
      </a>
      {kind === "audio" && <audio controls preload="none" src={url} className="hidden h-8 max-w-[14rem] sm:block" />}
      <a
        href={api.attachmentUrl(a.id, true)}
        aria-label={`Download ${a.name}`}
        title="Download"
        className="rounded-control p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <DownloadIcon />
      </a>
      <button
        type="button"
        aria-label={`Delete ${a.name}`}
        title="Delete"
        onClick={() => confirm(`Delete "${a.name}"?`) && onRemove()}
        className="rounded-control p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-danger"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

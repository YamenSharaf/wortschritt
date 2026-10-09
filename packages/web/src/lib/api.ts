import { createApi } from "@mdb/client";

export {
  ApiError,
  formsFromLookup,
  type AskBody,
  type ChatTurn,
  type StoryGenerationEvent,
} from "@mdb/client";

/** The server this page came from, signed in by its session cookie. */
export const api = createApi({
  fetch: (url, init) => fetch(url, { credentials: "same-origin", ...init } as RequestInit),
});

export const askAssistant = api.askAssistant;
export const generateStory = api.generateStory;

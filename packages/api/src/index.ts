import { buildApp } from "./app";
import { env } from "./env";
import { resumeStoryAudio } from "./services/storyAudio";
import { startVoiceSamples } from "./tts/samples";

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  // Stories that were waiting for their audio carry on.
  resumeStoryAudio(app.log);
  // The voice pickers' samples, made ahead of time.
  startVoiceSamples(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

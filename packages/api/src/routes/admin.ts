import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  adminSetPasswordBody,
  adminUser,
  registrationStatus as registrationStatusDto,
  timezoneSetting,
  setRegistrationBody,
  updateUserBody,
} from "@mdb/shared";
import { revokeUserGrants } from "../auth/oauth";
import { endOtherSessions, requireAdmin } from "../auth/session";
import {
  deleteUser,
  findUserById,
  listUsers,
  otherActiveAdmins,
  setPassword,
  updateUser,
} from "../auth/users";
import { registrationStatus, setRegistrationOpen } from "../services/registration";
import { getTimezone, isValidTimezone, setTimezone } from "../services/timezone";

const error = z.object({ error: z.string() });
const ok = z.object({ ok: z.literal(true) });
const idParams = z.object({ id: z.coerce.number().int().positive() });

/** User management and instance settings. Every route is admin-only. */
export async function adminRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const base = { preHandler: requireAdmin };

  r.get(
    "/api/admin/users",
    { ...base, schema: { tags: ["admin"], response: { 200: z.array(adminUser) } } },
    async () => listUsers(),
  );

  r.patch(
    "/api/admin/users/:id",
    {
      ...base,
      schema: {
        tags: ["admin"],
        params: idParams,
        body: updateUserBody,
        response: { 200: ok, 400: error, 404: error },
      },
    },
    async (req, reply) => {
      const target = findUserById(req.params.id);
      if (!target) return reply.code(404).send({ error: "no such user" });
      const { disabled, role } = req.body;
      const losesAdmin =
        target.role === "admin" && (disabled === true || role === "user");
      if (losesAdmin && otherActiveAdmins(target.id) === 0) {
        return reply.code(400).send({ error: "there must be at least one active admin" });
      }
      updateUser(target.id, req.body);
      // A disabled account is signed out everywhere immediately.
      if (disabled) endOtherSessions(target.id);
      return { ok: true as const };
    },
  );

  // Set a temporary password (e.g. the user forgot theirs). Ends their sessions.
  r.post(
    "/api/admin/users/:id/password",
    {
      ...base,
      schema: {
        tags: ["admin"],
        params: idParams,
        body: adminSetPasswordBody,
        response: { 200: ok, 404: error },
      },
    },
    async (req, reply) => {
      if (!findUserById(req.params.id)) {
        return reply.code(404).send({ error: "no such user" });
      }
      await setPassword(req.params.id, req.body.password);
      endOtherSessions(req.params.id);
      revokeUserGrants(req.params.id);
      return { ok: true as const };
    },
  );

  // Delete an account and all its learner data. Imports it made stay.
  r.delete(
    "/api/admin/users/:id",
    {
      ...base,
      schema: {
        tags: ["admin"],
        params: idParams,
        response: { 200: ok, 400: error, 404: error },
      },
    },
    async (req, reply) => {
      const target = findUserById(req.params.id);
      if (!target) return reply.code(404).send({ error: "no such user" });
      if (target.id === req.user!.id) {
        return reply.code(400).send({ error: "you can't delete your own account" });
      }
      if (target.role === "admin" && otherActiveAdmins(target.id) === 0) {
        return reply.code(400).send({ error: "there must be at least one active admin" });
      }
      deleteUser(target.id);
      req.log.info({ username: target.username }, "user deleted");
      return { ok: true as const };
    },
  );

  r.get(
    "/api/admin/registration",
    { ...base, schema: { tags: ["admin"], response: { 200: registrationStatusDto } } },
    async () => registrationStatus(),
  );

  r.put(
    "/api/admin/registration",
    {
      ...base,
      schema: {
        tags: ["admin"],
        body: setRegistrationBody,
        response: { 200: registrationStatusDto },
      },
    },
    async (req) => setRegistrationOpen(req.body.open),
  );

  // The server-wide time zone days are counted in.
  r.get(
    "/api/admin/timezone",
    { ...base, schema: { tags: ["admin"], response: { 200: timezoneSetting } } },
    async () => ({ timezone: getTimezone() }),
  );

  r.put(
    "/api/admin/timezone",
    {
      ...base,
      schema: {
        tags: ["admin"],
        body: timezoneSetting,
        response: { 200: timezoneSetting, 400: z.object({ error: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!isValidTimezone(req.body.timezone)) {
        return reply.code(400).send({ error: `unknown time zone "${req.body.timezone}"` });
      }
      return { timezone: setTimezone(req.body.timezone) };
    },
  );
}

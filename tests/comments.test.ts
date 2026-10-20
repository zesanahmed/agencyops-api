import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeTask, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

async function setup() {
  const project = await makeProject(w.orgId);
  const task = await makeTask(project.id);
  return { project, task, path: `/organizations/${w.orgId}/projects/${project.id}/tasks/${task.id}/comments` };
}

describe("comments", () => {
  it("creates, lists in order with pagination, and validates content", async () => {
    const { path } = await setup();
    const first = await call(w.member, "post", path, { content: "  First  " });
    expect(first.status).toBe(201);
    expect(first.body.data.comment.content).toBe("First");
    await call(w.owner, "post", path, { content: "Second" });
    await call(w.manager, "post", path, { content: "Third" });

    const all = await call(w.member, "get", path);
    expect(all.body.data.comments.map((c: { content: string }) => c.content)).toEqual(["First", "Second", "Third"]);
    const page = await call(w.member, "get", `${path}?limit=2&page=2`);
    expect(page.body.data.comments).toHaveLength(1);
    expect(page.body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    for (const body of [{}, { content: "   " }, { content: "x".repeat(10001) }, { content: "a", mentionedMembershipIds: ["nope"] }]) {
      expect((await call(w.member, "post", path, body)).status).toBe(400);
    }
  });

  it("only the author can edit; author or a moderator can delete; deleted comments disappear", async () => {
    const { path } = await setup();
    const c = (await call(w.member, "post", path, { content: "mine" })).body.data.comment;
    const one = `${path}/${c.id}`;

    expect((await call(w.owner, "patch", one, { content: "hijack" })).status).toBe(403); // even the owner cannot edit
    expect((await call(w.member, "patch", one, { content: "edited" })).body.data.comment.content).toBe("edited");

    const other = (await call(w.owner, "post", path, { content: "owner's" })).body.data.comment;
    expect((await call(w.member, "delete", `${path}/${other.id}`)).status).toBe(403); // not author, cannot moderate
    expect((await call(w.manager, "delete", one)).status).toBe(200); // moderator
    expect((await call(w.owner, "delete", `${path}/${other.id}`)).status).toBe(200); // author

    expect((await call(w.owner, "get", path)).body.data.comments).toHaveLength(0);
    expect((await call(w.member, "patch", one, { content: "again" })).status).toBe(404);
    expect((await call(w.manager, "delete", one)).status).toBe(404);
  });

  it("mentions notify the mentioned members except the author, and non-members are rejected", async () => {
    const { path } = await setup();
    const res = await call(w.member, "post", path, {
      content: "ping @manager @owner @me",
      mentionedMembershipIds: [w.managerMid, w.ownerMid, w.memberMid],
    });
    expect(res.status).toBe(201);
    const notified = await prisma.notification.findMany({ where: { type: "MENTION", data: { path: ["commentId"], equals: res.body.data.comment.id } } });
    expect(notified.map((n) => n.recipientMembershipId).sort()).toEqual([w.managerMid, w.ownerMid].sort());

    const bad = await call(w.member, "post", path, { content: "hi", mentionedMembershipIds: [w.other.ownerMid] });
    expect(bad.status).toBe(404);
    expect(await prisma.comment.count({ where: { content: "hi" } })).toBe(0);
  });

  it("is isolated by tenant, project and role", async () => {
    const { path, task } = await setup();
    const theirProject = await makeProject(w.other.orgId);
    const theirTask = await makeTask(theirProject.id);
    const theirPath = `/organizations/${w.orgId}/projects/${theirProject.id}/tasks/${theirTask.id}/comments`;

    expect((await call(w.owner, "get", theirPath)).status).toBe(404);
    expect((await call(w.owner, "post", theirPath, { content: "x" })).status).toBe(404);
    expect(await prisma.comment.count({ where: { taskId: theirTask.id } })).toBe(0);
    expect((await call(w.outsider, "get", path)).status).toBe(404);
    expect((await call(null, "get", path)).status).toBe(401);

    const sibling = await makeProject(w.orgId);
    expect((await call(w.owner, "get", `/organizations/${w.orgId}/projects/${sibling.id}/tasks/${task.id}/comments`)).status).toBe(404);
  });
});

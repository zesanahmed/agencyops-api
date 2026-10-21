import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers.js";
import { call, makeProject, makeSprint, makeTask, makeTeam, seedWorkspace, type Workspace } from "./fixtures.js";

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

const org = (rest = "") => `/organizations/${w.orgId}${rest}`;
const tasksOf = (projectId: string) => org(`/projects/${projectId}/tasks`);
const notifs = (membershipId: string, type: string) =>
  prisma.notification.findMany({ where: { recipientMembershipId: membershipId, type }, orderBy: { createdAt: "asc" } });

describe("caller membership on organization endpoints", () => {
  it("list items and detail include the caller's own membership; detail also lists permissions", async () => {
    const list = await call(w.member, "get", "/organizations");
    expect(list.body.data.organizations[0].membership).toEqual({ id: w.memberMid, role: "TEAM_MEMBER" });
    const detail = await call(w.manager, "get", org());
    expect(detail.body.data.organization.id).toBe(w.orgId);
    expect(detail.body.data.membership).toMatchObject({ id: w.managerMid, role: "MANAGER" });
    const perms: string[] = detail.body.data.membership.permissions;
    expect(perms).toContain("project:delete");
    expect(perms).not.toContain("billing:manage");
    const asMember = await call(w.member, "get", org());
    expect(asMember.body.data.membership.permissions).not.toContain("project:create");
    expect(asMember.body.data.membership.permissions).toContain("task:update");
  });
});

describe("D2: project aggregates", () => {
  it("list and detail carry taskCounts, memberCount and activeSprint", async () => {
    const project = await makeProject(w.orgId);
    const team = await makeTeam(w.orgId);
    await prisma.teamMember.createMany({ data: [{ teamId: team.id, membershipId: w.managerMid }, { teamId: team.id, membershipId: w.memberMid }] });
    await prisma.projectTeam.create({ data: { projectId: project.id, teamId: team.id } });
    await prisma.projectMember.createMany({ data: [{ projectId: project.id, membershipId: w.ownerMid }, { projectId: project.id, membershipId: w.memberMid }] });
    const sprint = await makeSprint(project.id, { status: "ACTIVE", name: "Live sprint" });
    const parent = await makeTask(project.id, { status: "TODO", sprintId: sprint.id });
    await makeTask(project.id, { status: "DONE" });
    await makeTask(project.id, { status: "DONE" });
    await makeTask(project.id, { status: "DONE", parentTaskId: parent.id }); // subtasks are not counted
    await makeTask(project.id, { status: "IN_REVIEW", deletedAt: new Date() }); // deleted are not counted
    const empty = await makeProject(w.orgId);

    const expected = {
      taskCounts: { BACKLOG: 0, TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 },
      memberCount: 3, // owner + member (explicit) + manager (team); member is counted once
      activeSprint: { id: sprint.id, name: "Live sprint" },
    };
    const detail = await call(w.member, "get", org(`/projects/${project.id}`));
    expect(detail.body.data.project).toMatchObject(expected);

    const list = await call(w.member, "get", org("/projects?limit=100"));
    const byId = Object.fromEntries(list.body.data.projects.map((p: { id: string }) => [p.id, p]));
    expect(byId[project.id]).toMatchObject(expected);
    expect(byId[empty.id]).toMatchObject({
      taskCounts: { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
      memberCount: 0,
      activeSprint: null,
    });
  });
});

describe("D3: user display info", () => {
  it("project members, team members, collaborators, assignee and comments expose user info only", async () => {
    const project = await makeProject(w.orgId);
    const team = await makeTeam(w.orgId);
    const task = await makeTask(project.id, { assigneeMembershipId: w.memberMid });
    const user = { id: w.member.id, name: "Maya Member", email: w.member.email, avatarUrl: null };

    const pm = await call(w.manager, "post", org(`/projects/${project.id}/members`), { membershipId: w.memberMid });
    expect(pm.body.data.member.user).toEqual(user);
    expect((await call(w.member, "get", org(`/projects/${project.id}/members`))).body.data.members[0].user).toEqual(user);

    const tm = await call(w.manager, "post", org(`/teams/${team.id}/members`), { membershipId: w.memberMid });
    expect(tm.body.data.member.user).toEqual(user);
    expect((await call(w.member, "get", org(`/teams/${team.id}/members`))).body.data.members[0].user).toEqual(user);

    const collab = await call(w.manager, "post", `${tasksOf(project.id)}/${task.id}/collaborators`, { membershipId: w.managerMid });
    expect(collab.body.data.collaborator.user).toMatchObject({ name: "Manny Manager" });
    expect((await call(w.owner, "get", `${tasksOf(project.id)}/${task.id}/collaborators`)).body.data.collaborators[0].user.email).toBe(w.manager.email);

    const got = await call(w.owner, "get", `${tasksOf(project.id)}/${task.id}`);
    expect(got.body.data.task.assignee).toEqual({ membershipId: w.memberMid, user });
    expect((await call(w.owner, "get", `${tasksOf(project.id)}?limit=100`)).body.data.tasks[0].assignee.user.name).toBe("Maya Member");
    const unassigned = await makeTask(project.id);
    expect((await call(w.owner, "get", `${tasksOf(project.id)}/${unassigned.id}`)).body.data.task.assignee).toBeNull();

    const comment = await call(w.owner, "post", `${tasksOf(project.id)}/${task.id}/comments`, {
      content: "hi @Maya Member",
      mentionedMembershipIds: [w.memberMid],
    });
    expect(comment.body.data.comment.author).toMatchObject({ membershipId: w.ownerMid, user: { name: "Olivia Owner" } });
    expect(comment.body.data.comment.mentions).toEqual([{ membershipId: w.memberMid, user }]);
    const listed = await call(w.owner, "get", `${tasksOf(project.id)}/${task.id}/comments`);
    expect(listed.body.data.comments[0].mentions[0].user.id).toBe(w.member.id);

    const everything = JSON.stringify([pm.body, got.body, comment.body]);
    expect(everything).not.toMatch(/passwordHash|refreshToken|"status":"ACTIVE","emailVerifiedAt/);
  });

  it("tasks carry subtask and comment counts", async () => {
    const project = await makeProject(w.orgId);
    const parent = await makeTask(project.id);
    await makeTask(project.id, { parentTaskId: parent.id, status: "DONE" });
    await makeTask(project.id, { parentTaskId: parent.id, status: "TODO" });
    await makeTask(project.id, { parentTaskId: parent.id, status: "DONE", deletedAt: new Date() });
    const authorId = w.ownerMid;
    await prisma.comment.createMany({
      data: [
        { taskId: parent.id, authorMembershipId: authorId, content: "a" },
        { taskId: parent.id, authorMembershipId: authorId, content: "b" },
        { taskId: parent.id, authorMembershipId: authorId, content: "gone", deletedAt: new Date() },
      ],
    });
    const detail = await call(w.owner, "get", `${tasksOf(project.id)}/${parent.id}`);
    expect(detail.body.data.task).toMatchObject({ subtaskCount: 2, doneSubtaskCount: 1, commentCount: 2 });
    const list = await call(w.owner, "get", tasksOf(project.id));
    expect(list.body.data.tasks[0]).toMatchObject({ subtaskCount: 2, doneSubtaskCount: 1, commentCount: 2 });
  });
});

describe("D4: API gaps", () => {
  it("sprintId=none lists only tasks that are in no sprint", async () => {
    const project = await makeProject(w.orgId);
    const sprint = await makeSprint(project.id);
    await makeTask(project.id, { title: "In sprint", sprintId: sprint.id });
    await makeTask(project.id, { title: "Backlog one" });
    const res = await call(w.member, "get", `${tasksOf(project.id)}?sprintId=none`);
    expect(res.body.data.tasks.map((t: { title: string }) => t.title)).toEqual(["Backlog one"]);
    expect((await call(w.member, "get", `${tasksOf(project.id)}?sprintId=nope`)).status).toBe(400);
  });

  it("completing a sprint can move open tasks to the backlog or another sprint", async () => {
    const project = await makeProject(w.orgId);
    const path = (id: string) => org(`/projects/${project.id}/sprints/${id}`);
    const setup = async () => {
      const sprint = await makeSprint(project.id, { status: "ACTIVE" });
      const open = await makeTask(project.id, { sprintId: sprint.id, status: "IN_PROGRESS" });
      const sub = await makeTask(project.id, { sprintId: sprint.id, status: "TODO", parentTaskId: open.id });
      const done = await makeTask(project.id, { sprintId: sprint.id, status: "DONE" });
      return { sprint, open, sub, done };
    };

    // Default: nothing moves.
    const a = await setup();
    const plain = await call(w.manager, "post", `${path(a.sprint.id)}/complete`);
    expect(plain.status).toBe(200);
    expect(plain.body.data).toMatchObject({ sprint: { status: "COMPLETED" }, movedTaskCount: 0 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.open.id } })).sprintId).toBe(a.sprint.id);

    // To the backlog.
    const b = await setup();
    const toBacklog = await call(w.manager, "post", `${path(b.sprint.id)}/complete`, { moveOpenTasksTo: "BACKLOG" });
    expect(toBacklog.body.data.movedTaskCount).toBe(2);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.open.id } })).sprintId).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.sub.id } })).sprintId).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.done.id } })).sprintId).toBe(b.sprint.id);

    // To a planned sprint; invalid targets change nothing.
    const c = await setup();
    const target = await makeSprint(project.id);
    const completed = await makeSprint(project.id, { status: "COMPLETED" });
    const foreign = await makeSprint((await makeProject(w.orgId)).id);
    expect((await call(w.manager, "post", `${path(c.sprint.id)}/complete`, { moveOpenTasksTo: c.sprint.id })).status).toBe(400);
    expect((await call(w.manager, "post", `${path(c.sprint.id)}/complete`, { moveOpenTasksTo: completed.id })).status).toBe(409);
    expect((await call(w.manager, "post", `${path(c.sprint.id)}/complete`, { moveOpenTasksTo: foreign.id })).status).toBe(404);
    expect((await call(w.manager, "post", `${path(c.sprint.id)}/complete`, { moveOpenTasksTo: "nope" })).status).toBe(400);
    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: c.sprint.id } })).status).toBe("ACTIVE");
    const ok = await call(w.manager, "post", `${path(c.sprint.id)}/complete`, { moveOpenTasksTo: target.id });
    expect(ok.body.data.movedTaskCount).toBe(2);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.open.id } })).sprintId).toBe(target.id);
  });

  it("editing a comment can replace mentions and notifies only the newly mentioned", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id);
    const base = `${tasksOf(project.id)}/${task.id}/comments`;
    const created = await call(w.owner, "post", base, { content: "first @Manny Manager", mentionedMembershipIds: [w.managerMid] });
    const id = created.body.data.comment.id as string;
    const before = (await notifs(w.managerMid, "MENTION")).length;

    const edited = await call(w.owner, "patch", `${base}/${id}`, {
      content: "now @Manny Manager and @Maya Member",
      mentionedMembershipIds: [w.managerMid, w.memberMid],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.comment.mentions.map((m: { membershipId: string }) => m.membershipId).sort()).toEqual([w.managerMid, w.memberMid].sort());
    expect((await notifs(w.managerMid, "MENTION")).length).toBe(before); // already mentioned: no repeat
    const forMember = (await notifs(w.memberMid, "MENTION")).filter((n) => (n.data as { commentId?: string } | null)?.commentId === id);
    expect(forMember).toHaveLength(1);

    const dropped = await call(w.owner, "patch", `${base}/${id}`, { content: "only me", mentionedMembershipIds: [] });
    expect(dropped.body.data.comment.mentions).toEqual([]);
    // Omitting the field leaves mentions untouched.
    await call(w.owner, "patch", `${base}/${id}`, { content: "again", mentionedMembershipIds: [w.managerMid] });
    const untouched = await call(w.owner, "patch", `${base}/${id}`, { content: "text only" });
    expect(untouched.body.data.comment.mentions).toHaveLength(1);
    expect((await call(w.owner, "patch", `${base}/${id}`, { content: "x", mentionedMembershipIds: [w.other.ownerMid] })).status).toBe(404);
  });

  it("TASK_ASSIGNED goes to the new assignee (never the actor) and honours preferences", async () => {
    const project = await makeProject(w.orgId);
    const created = await call(w.manager, "post", tasksOf(project.id), { title: "Assign me", assigneeMembershipId: w.memberMid });
    const taskId = created.body.data.task.id as string;
    const got = await notifs(w.memberMid, "TASK_ASSIGNED");
    const mine = got.filter((n) => (n.data as { taskId?: string } | null)?.taskId === taskId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toEqual({ projectId: project.id, taskId });

    // Self-assignment: no notification.
    const self = await call(w.member, "post", tasksOf(project.id), { title: "Mine", assigneeMembershipId: w.memberMid });
    const selfNotes = (await notifs(w.memberMid, "TASK_ASSIGNED")).filter((n) => (n.data as { taskId?: string } | null)?.taskId === self.body.data.task.id);
    expect(selfNotes).toHaveLength(0);

    // Reassign via update; with the preference off the in-app row is skipped.
    await call(w.manager, "put", org("/notifications/preferences/TASK_ASSIGNED"), { inAppEnabled: false, emailEnabled: false });
    await call(w.owner, "patch", `${tasksOf(project.id)}/${taskId}`, { assigneeMembershipId: w.managerMid });
    expect((await notifs(w.managerMid, "TASK_ASSIGNED")).filter((n) => (n.data as { taskId?: string } | null)?.taskId === taskId)).toHaveLength(0);
    await call(w.owner, "patch", `${tasksOf(project.id)}/${taskId}`, { assigneeMembershipId: w.memberMid });
    expect((await notifs(w.memberMid, "TASK_ASSIGNED")).filter((n) => (n.data as { taskId?: string } | null)?.taskId === taskId)).toHaveLength(2);
  });

  it("TASK_STATUS_CHANGED reaches assignee and collaborators but not the actor", async () => {
    const project = await makeProject(w.orgId);
    const task = await makeTask(project.id, { assigneeMembershipId: w.memberMid, status: "TODO" });
    await prisma.taskCollaborator.create({ data: { taskId: task.id, membershipId: w.managerMid } });
    const path = `${tasksOf(project.id)}/${task.id}`;

    await call(w.owner, "patch", path, { status: "IN_PROGRESS" });
    const find = async (mid: string) => (await notifs(mid, "TASK_STATUS_CHANGED")).filter((n) => (n.data as { taskId?: string } | null)?.taskId === task.id);
    expect(await find(w.memberMid)).toHaveLength(1);
    expect(await find(w.managerMid)).toHaveLength(1);
    expect(await find(w.ownerMid)).toHaveLength(0);
    expect((await find(w.memberMid))[0]!.data).toMatchObject({ from: "TODO", to: "IN_PROGRESS", projectId: project.id });

    // The assignee changing it themselves is not told; same-status saves notify nobody.
    await call(w.member, "patch", path, { status: "DONE" });
    expect(await find(w.memberMid)).toHaveLength(1);
    expect(await find(w.managerMid)).toHaveLength(2);
    await call(w.owner, "patch", path, { status: "DONE", title: "Renamed" });
    expect(await find(w.managerMid)).toHaveLength(2);
  });

  it("SPRINT_STARTED reaches project members and sprint assignees, not the actor", async () => {
    const project = await makeProject(w.orgId);
    await prisma.projectMember.create({ data: { projectId: project.id, membershipId: w.memberMid } });
    const sprint = await makeSprint(project.id);
    await makeTask(project.id, { sprintId: sprint.id, assigneeMembershipId: w.ownerMid });
    await call(w.manager, "post", org(`/projects/${project.id}/sprints/${sprint.id}/start`));
    const find = async (mid: string) => (await notifs(mid, "SPRINT_STARTED")).filter((n) => (n.data as { sprintId?: string } | null)?.sprintId === sprint.id);
    expect(await find(w.memberMid)).toHaveLength(1);
    expect(await find(w.ownerMid)).toHaveLength(1);
    expect(await find(w.managerMid)).toHaveLength(0);
    expect((await find(w.memberMid))[0]!.data).toEqual({ projectId: project.id, sprintId: sprint.id });
  });
});

describe("D1: activity feed", () => {
  it("records the main events with an actor, and a readable summary", async () => {
    await prisma.activity.deleteMany({ where: { organizationId: w.orgId } });
    const created = await call(w.owner, "post", org("/projects"), { name: "Feed Project" });
    const projectId = created.body.data.project.id as string;
    const sprint = (await call(w.manager, "post", org(`/projects/${projectId}/sprints`), { name: "S1", startDate: "2026-01-01", endDate: "2026-01-14" })).body.data.sprint;
    const task = (await call(w.member, "post", tasksOf(projectId), { title: "Do it" })).body.data.task;
    await call(w.member, "patch", `${tasksOf(projectId)}/${task.id}`, { status: "IN_PROGRESS" });
    await call(w.manager, "patch", `${tasksOf(projectId)}/${task.id}`, { assigneeMembershipId: w.memberMid });
    await call(w.member, "patch", `${tasksOf(projectId)}/${task.id}`, { priority: "HIGH" });
    await call(w.member, "post", `${tasksOf(projectId)}/${task.id}/comments`, { content: "done soon" });
    await call(w.manager, "post", org(`/projects/${projectId}/sprints/${sprint.id}/start`));
    await call(w.member, "post", `${tasksOf(projectId)}/${task.id}/subtasks`, { title: "Sub" });
    await call(w.owner, "delete", `${tasksOf(projectId)}/${task.id}`);

    const res = await call(w.owner, "get", org(`/activity?projectId=${projectId}&limit=50`));
    expect(res.status).toBe(200);
    const actions = res.body.data.activities.map((a: { action: string }) => a.action);
    expect(actions).toEqual([
      "task.deleted",
      "task.created", // subtask
      "sprint.started",
      "comment.added",
      "task.updated",
      "task.assigned",
      "task.status_changed",
      "task.created",
      "sprint.created",
      "project.created",
    ]);
    const bySummary = res.body.data.activities.map((a: { summary: string }) => a.summary);
    expect(bySummary).toContain("Olivia Owner created project “Feed Project”");
    expect(bySummary).toContain("Maya Member moved “Do it” from Backlog to In progress");
    expect(bySummary).toContain("Manny Manager assigned “Do it” to Maya Member");
    expect(bySummary).toContain("Maya Member added subtask “Sub”");
    expect(res.body.data.activities[0]).toMatchObject({
      entityType: "Task",
      projectId,
      actor: { membershipId: w.ownerMid, name: "Olivia Owner" },
      metadata: { title: "Do it" },
    });
    expect(res.body.data.pagination).toMatchObject({ total: 10, page: 1, limit: 50 });
  });

  it("filters by task, actor, entity type and paginates newest first", async () => {
    const project = await makeProject(w.orgId);
    const t1 = (await call(w.member, "post", tasksOf(project.id), { title: "One" })).body.data.task;
    await call(w.member, "post", tasksOf(project.id), { title: "Two" });
    await call(w.owner, "post", `${tasksOf(project.id)}/${t1.id}/comments`, { content: "x" });

    const byTask = await call(w.owner, "get", org(`/activity?taskId=${t1.id}`));
    expect(byTask.body.data.activities.map((a: { action: string }) => a.action)).toEqual(["comment.added", "task.created"]);
    const byActor = await call(w.owner, "get", org(`/activity?projectId=${project.id}&actorMembershipId=${w.memberMid}`));
    expect(byActor.body.data.pagination.total).toBe(2);
    const byType = await call(w.owner, "get", org(`/activity?projectId=${project.id}&entityType=Comment`));
    expect(byType.body.data.activities).toHaveLength(1);
    const page = await call(w.owner, "get", org(`/activity?projectId=${project.id}&limit=1&page=2`));
    expect(page.body.data.activities).toHaveLength(1);
    expect(page.body.data.pagination).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3 });
    for (const q of ["limit=101", "entityType=Nope", "projectId=nope"]) {
      expect((await call(w.owner, "get", org(`/activity?${q}`))).status).toBe(400);
    }
  });

  it("records member joined/removed (organization-level) and TEAM_MEMBER cannot see them", async () => {
    const outsider = w.outsider;
    const email = outsider.email;
    const invite = await call(w.owner, "post", org("/invitations"), { email, role: "TEAM_MEMBER" });
    await call(outsider, "post", `/invitations/${invite.body.data.inviteToken}/accept`);
    const joined = await prisma.membership.findFirstOrThrow({ where: { userId: outsider.id, organizationId: w.orgId } });
    await call(w.owner, "delete", org(`/members/${joined.id}`));

    const all = await call(w.owner, "get", org("/activity?entityType=Membership&limit=50"));
    const summaries = all.body.data.activities.map((a: { summary: string }) => a.summary);
    expect(summaries).toContain("Otto Outsider joined the organization");
    expect(summaries).toContain("Olivia Owner removed Otto Outsider from the organization");
    const mine = await call(w.member, "get", org("/activity?entityType=Membership"));
    expect(mine.body.data.activities).toEqual([]);
  });

  it("TEAM_MEMBER only sees projects they belong to (explicitly or through a team); managers see all", async () => {
    const mine = await makeProject(w.orgId);
    const viaTeam = await makeProject(w.orgId);
    const hidden = await makeProject(w.orgId);
    await prisma.projectMember.create({ data: { projectId: mine.id, membershipId: w.memberMid } });
    const team = await makeTeam(w.orgId);
    await prisma.teamMember.create({ data: { teamId: team.id, membershipId: w.memberMid } });
    await prisma.projectTeam.create({ data: { projectId: viaTeam.id, teamId: team.id } });
    for (const p of [mine, viaTeam, hidden]) await call(w.owner, "post", tasksOf(p.id), { title: `Task in ${p.slug}` });

    const asMember = await call(w.member, "get", org("/activity?limit=100"));
    const projectIds = new Set(asMember.body.data.activities.map((a: { projectId: string | null }) => a.projectId));
    expect(projectIds.has(mine.id)).toBe(true);
    expect(projectIds.has(viaTeam.id)).toBe(true);
    expect(projectIds.has(hidden.id)).toBe(false);
    expect(projectIds.has(null)).toBe(false);

    const direct = await call(w.member, "get", org(`/activity?projectId=${hidden.id}`));
    expect(direct.status).toBe(200);
    expect(direct.body.data.activities).toEqual([]);

    const asManager = await call(w.manager, "get", org(`/activity?projectId=${hidden.id}`));
    expect(asManager.body.data.activities).toHaveLength(1);
  });

  it("is tenant-isolated and needs authentication", async () => {
    const theirs = await makeProject(w.other.orgId);
    await call(w.other.owner, "post", `/organizations/${w.other.orgId}/projects/${theirs.id}/tasks`, { title: "Secret" });
    expect((await call(w.outsider, "get", org("/activity"))).status).toBe(404);
    expect((await call(null, "get", org("/activity"))).status).toBe(401);
    const res = await call(w.owner, "get", org("/activity?limit=100"));
    expect(JSON.stringify(res.body)).not.toContain("Secret");
    expect((await call(w.owner, "get", org(`/activity?projectId=${theirs.id}`))).body.data.activities).toEqual([]);
  });
});

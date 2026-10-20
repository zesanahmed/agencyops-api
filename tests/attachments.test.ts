import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { api, app, auth, prisma, request } from "./helpers.js";
import { call, makeProject, makeTask, seedWorkspace, type Workspace } from "./fixtures.js";

const cloud = vi.hoisted(() => ({ upload: vi.fn(), destroy: vi.fn() }));

vi.mock("cloudinary", () => ({
  v2: { config: vi.fn(), uploader: { upload_stream: cloud.upload, destroy: cloud.destroy } },
}));

let w: Workspace;
beforeAll(async () => {
  w = await seedWorkspace();
}, 60_000);

beforeEach(() => {
  env.cloudinary = { cloudName: "c", apiKey: "k", apiSecret: "s" };
  cloud.destroy.mockReset().mockResolvedValue({ result: "ok" });
  cloud.upload.mockReset().mockImplementation((_opts, cb: (e: unknown, r: unknown) => void) => ({
    end: () => cb(null, { public_id: "pid-1", secure_url: "https://cdn.test/pid-1" }),
  }));
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function setup() {
  const project = await makeProject(w.orgId);
  const task = await makeTask(project.id);
  return { project, task, path: `/organizations/${w.orgId}/projects/${project.id}/tasks/${task.id}/attachments` };
}
const upload = (user: typeof w.owner, path: string, buf: Buffer, contentType: string, filename = "f.bin") =>
  request(app).post(`${api}${path}`).set(auth(user)).attach("file", buf, { filename, contentType });

describe("task attachments", () => {
  it("answers 503 when file storage is not configured", async () => {
    const { path } = await setup();
    env.cloudinary = undefined;
    expect((await upload(w.owner, path, PNG, "image/png")).status).toBe(503);
  });

  it("uploads to Cloudinary under the org/task folder, stores metadata, lists and deletes", async () => {
    const { task, path } = await setup();
    const res = await upload(w.member, path, PNG, "image/png", "logo.png");
    expect(res.status).toBe(201);
    expect(res.body.data.attachment).toMatchObject({ originalFilename: "logo.png", mimeType: "image/png", sizeBytes: PNG.length });
    expect(cloud.upload.mock.calls[0]![0].folder).toBe(`agencyops/${w.orgId}/tasks/${task.id}`);

    const list = await call(w.member, "get", path);
    expect(list.body.data.attachments).toHaveLength(1);

    const id = res.body.data.attachment.id as string;
    expect((await call(w.member, "delete", `${path}/${id}`)).status).toBe(200);
    expect(cloud.destroy).toHaveBeenCalledWith("pid-1");
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(0);
    expect((await call(w.member, "delete", `${path}/${id}`)).status).toBe(404);
  });

  it("still removes the record when Cloudinary deletion fails", async () => {
    const { task, path } = await setup();
    const id = (await upload(w.owner, path, PNG, "image/png")).body.data.attachment.id as string;
    cloud.destroy.mockRejectedValue(new Error("boom"));
    expect((await call(w.owner, "delete", `${path}/${id}`)).status).toBe(200);
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("rejects missing files, disallowed types, oversize files and spoofed content", async () => {
    const { task, path } = await setup();
    expect((await request(app).post(`${api}${path}`).set(auth(w.owner))).status).toBe(400);
    expect((await upload(w.owner, path, Buffer.from("MZ"), "application/x-msdownload")).status).toBe(400);
    expect((await upload(w.owner, path, Buffer.alloc(10 * 1024 * 1024 + 1, 0x41), "text/plain")).status).toBe(400);
    // Claims PNG, is actually an executable/script.
    expect((await upload(w.owner, path, Buffer.from("<script>alert(1)</script>"), "image/png")).status).toBe(400);
    expect(cloud.upload).not.toHaveBeenCalled();
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("returns 502 when the Cloudinary upload itself fails and stores nothing", async () => {
    const { task, path } = await setup();
    cloud.upload.mockImplementation((_o, cb: (e: unknown) => void) => ({ end: () => cb(new Error("down")) }));
    expect((await upload(w.owner, path, PNG, "image/png")).status).toBe(502);
    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("enforces roles and tenancy", async () => {
    const { path } = await setup();
    const theirs = await makeTask((await makeProject(w.other.orgId)).id);
    const theirPath = `/organizations/${w.orgId}/projects/${theirs.projectId}/tasks/${theirs.id}/attachments`;

    expect((await upload(w.outsider, path, PNG, "image/png")).status).toBe(404);
    expect((await call(null, "get", path)).status).toBe(401);
    expect((await upload(w.owner, theirPath, PNG, "image/png")).status).toBe(404);
    expect((await call(w.owner, "get", theirPath)).status).toBe(404);
    expect(cloud.upload).not.toHaveBeenCalled();
  });
});

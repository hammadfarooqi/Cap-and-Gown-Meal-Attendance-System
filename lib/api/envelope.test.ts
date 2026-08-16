import { describe, it, expect, beforeEach } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { readVersions, bumpVersion, envelope } from "./envelope";

const db = serviceClient();

beforeEach(async () => {
  await db.from("versions").upsert([
    { resource: "roster", version: 1 },
    { resource: "schedule", version: 1 },
  ]);
});

describe("versions", () => {
  it("reads both resource versions", async () => {
    expect(await readVersions()).toEqual({ roster: 1, schedule: 1 });
  });

  it("bumps only the named resource", async () => {
    await bumpVersion("roster");
    expect(await readVersions()).toEqual({ roster: 2, schedule: 1 });
  });

  it("bumps cumulatively", async () => {
    await bumpVersion("schedule");
    await bumpVersion("schedule");
    expect(await readVersions()).toEqual({ roster: 1, schedule: 3 });
  });

  it("wraps data with the current versions", async () => {
    await bumpVersion("schedule");
    expect(await envelope({ hello: "world" })).toEqual({
      data: { hello: "world" },
      versions: { roster: 1, schedule: 2 },
    });
  });
});

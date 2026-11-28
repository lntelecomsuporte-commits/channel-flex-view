import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findInnovaPrograms,
  loadInnovaCreds,
  motvChannelsToList,
  motvEventsToByChannel,
} from "../../scripts/innovatv-motv.mjs";
import { findInnovaTvPrograms } from "@/lib/innovatv";

const events = [
  { channels_id: 9, title: "Naruto", description: "Episódio 1", start: "2026-11-27T21:00:00-03:00", rating: "12" },
  { channels_id: 9, title: "Bleach", description: "Bleach", start: "2026-11-27T20:00:00-03:00", rating: "-1" },
  { channels_id: 9, title: "Bleach", description: "", start: "2026-11-27T20:00:00-03:00" },
  { channels_id: 3, title: "Cinema Asiático", description: null, start: "2026-11-27T17:00:00-03:00" },
  { channels_id: 3, title: "", start: "2026-11-27T19:00:00-03:00" },
];

const feed = {
  channels: motvChannelsToList([
    { channels_id: 9, channels_name: "HALLO! Anime" },
    { channels_id: 3, channels_name: "HALLO! Movies 2" },
  ]),
  byChannel: motvEventsToByChannel(events),
};

describe("InnovaTV MOTV grade", () => {
  it("converts Brasília times to UTC, ordered per channel without duplicate starts", () => {
    expect(feed.byChannel["9"].map((p) => [p.start_date, p.title])).toEqual([
      ["2026-11-27T23:00:00.000Z", "Bleach"],
      ["2026-11-28T00:00:00.000Z", "Naruto"],
    ]);
    expect(feed.byChannel["9"][1]).toMatchObject({ desc: "Episódio 1", rating: "12" });
    expect(feed.byChannel["9"][0]).toMatchObject({ desc: null, rating: null });
    expect(feed.byChannel["3"]).toHaveLength(1);
  });

  it("finds a channel by InnovaTV ID or by the name used in older registrations", () => {
    expect(findInnovaPrograms("9", feed)?.[0].title).toBe("Bleach");
    expect(findInnovaPrograms("Hallo Anime", feed)?.[0].title).toBe("Bleach");
    expect(findInnovaPrograms("hallo movies 2", feed)?.[0].title).toBe("Cinema Asiático");
    expect(findInnovaPrograms("BM&C News", feed)).toBeNull();
  });

  it("uses the same matching in the panel test button", () => {
    expect(findInnovaTvPrograms("9", feed)?.length).toBe(2);
    expect(findInnovaTvPrograms("HALLO! Anime", feed)?.length).toBe(2);
    expect(findInnovaTvPrograms("99", feed)).toBeNull();
  });

  it("reads the server credentials from .env.innovatv and reports none when absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "innova-"));
    expect(await loadInnovaCreds(dir, {})).toBeNull();
    writeFileSync(join(dir, ".env.innovatv"), 'INNOVATV_EMAIL=ops@example.com\nINNOVATV_PASSWORD="p@ss=word"\n');
    expect(await loadInnovaCreds(dir, {})).toEqual({ email: "ops@example.com", password: "p@ss=word", vendorId: 1 });
  });
});

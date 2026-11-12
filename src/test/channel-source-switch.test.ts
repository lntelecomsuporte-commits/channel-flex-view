import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeSourceOrigin,
  planChannelSourceSwitch,
  type ChannelSourceRecord,
} from "@/lib/channelSourceSwitch";

const cnt: ChannelSourceRecord = {
  id: "cnt",
  name: "CNT",
  channel_number: 10,
  stream_url: "http://178.92.163.93:5001/live/cnt/index.m3u8",
  backup_stream_urls: [
    "http://151.242.41.43:5001/live/cnt/index.m3u8",
    "https://backup2.example.com/cnt/index.m3u8",
  ],
};

describe("troca de fonte dos canais", () => {
  it("abre a prévia vazia sem erro antes de informar o endereço", () => {
    expect(planChannelSourceSwitch([cnt], {
      mode: "invert",
      sourceOrigin: null,
      saveOldAsBackup: true,
    })).toEqual([]);
  });

  it("inverte principal e backup 1 preservando os demais backups", () => {
    const [item] = planChannelSourceSwitch([cnt], {
      mode: "invert",
      sourceOrigin: "http://178.92.163.93:5001",
      saveOldAsBackup: true,
    });
    expect(item.nextStreamUrl).toBe("http://151.242.41.43:5001/live/cnt/index.m3u8");
    expect(item.nextBackupStreamUrls).toEqual([
      "http://178.92.163.93:5001/live/cnt/index.m3u8",
      "https://backup2.example.com/cnt/index.m3u8",
    ]);
  });

  it("encontra somente o IP e porta informados e mantém o caminho na substituição", () => {
    const other = { ...cnt, id: "other", stream_url: "http://178.92.163.93:5002/live/cnt/index.m3u8" };
    const items = planChannelSourceSwitch([cnt, other], {
      mode: "replace",
      sourceOrigin: "http://178.92.163.93:5001/live/cnt/index.m3u8",
      replacementOrigin: "https://151.242.41.43:5801",
      saveOldAsBackup: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].nextStreamUrl).toBe("https://151.242.41.43:5801/live/cnt/index.m3u8");
    expect(items[0].nextBackupStreamUrls[0]).toBe(cnt.stream_url);
  });

  it("sinaliza canal sem backup e não gera uma nova principal vazia", () => {
    const [item] = planChannelSourceSwitch([{ ...cnt, backup_stream_urls: [] }], {
      mode: "invert",
      sourceOrigin: "http://178.92.163.93:5001",
      saveOldAsBackup: true,
    });
    expect(item.nextStreamUrl).toBeNull();
    expect(item.skippedReason).toBe("missing_backup");
  });

  it("não guarda a principal antiga quando essa opção estiver desmarcada", () => {
    const [item] = planChannelSourceSwitch([cnt], {
      mode: "replace",
      sourceOrigin: "http://178.92.163.93:5001",
      replacementOrigin: "http://151.242.41.43:5001",
      saveOldAsBackup: false,
    });
    expect(item.nextBackupStreamUrls).toEqual(cnt.backup_stream_urls);
  });

  it("normaliza uma URL colada e rejeita protocolos não suportados", () => {
    expect(normalizeSourceOrigin("HTTP://178.92.163.93:5001/live/cnt/index.m3u8"))
      .toBe("http://178.92.163.93:5001");
    expect(normalizeSourceOrigin("rtsp://178.92.163.93:5001/live/cnt")).toBeNull();
  });

  it("preserva a porta explícita ao comparar e remove a origem inteira ao substituir", () => {
    const explicitDefaultPort = { ...cnt, stream_url: "http://178.92.163.93:80/live/cnt/index.m3u8" };
    const [item] = planChannelSourceSwitch([explicitDefaultPort], {
      mode: "replace",
      sourceOrigin: "http://178.92.163.93:80",
      replacementOrigin: "https://151.242.41.43:5801",
      saveOldAsBackup: true,
    });
    expect(item.nextStreamUrl).toBe("https://151.242.41.43:5801/live/cnt/index.m3u8");
  });

  it("exige a permissão channels.switch_source no banco e bloqueia execução pública", () => {
    const sql = readFileSync("drizzle/migrations/0004_channel_source_switcher.sql", "utf8");
    expect(sql).toContain("public.has_admin_permission(v_actor, 'channels.switch_source')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.switch_channel_sources(text, text, text, boolean) FROM PUBLIC");
  });
});

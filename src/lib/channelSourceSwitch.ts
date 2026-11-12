export type ChannelSourceSwitchMode = "invert" | "replace";

export type ChannelSourceRecord = {
  id: string;
  name: string;
  channel_number: number;
  stream_url: string;
  backup_stream_urls: string[] | null;
};

export type ChannelSourcePlanItem = {
  channel: ChannelSourceRecord;
  nextStreamUrl: string | null;
  nextBackupStreamUrls: string[];
  skippedReason: "missing_backup" | null;
};

export type ChannelSourceSwitchOptions = {
  mode: ChannelSourceSwitchMode;
  sourceOrigin: string | null;
  replacementOrigin?: string | null;
  saveOldAsBackup: boolean;
};

/** Accepts an origin or a pasted stream URL and returns only its normalized origin. */
export function normalizeSourceOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const origin = trimmed.match(/^https?:\/\/[^/?#]+/i)?.[0]?.toLowerCase();
    if (!origin || !/^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/.test(origin)) return null;
    return origin;
  } catch {
    return null;
  }
}

function originOf(streamUrl: string): string | null {
  return normalizeSourceOrigin(streamUrl);
}

/** Builds the same preview that the atomic database operation applies. */
export function planChannelSourceSwitch(
  channels: ChannelSourceRecord[],
  options: ChannelSourceSwitchOptions,
): ChannelSourcePlanItem[] {
  const source = normalizeSourceOrigin(options.sourceOrigin);
  const replacement = options.replacementOrigin
    ? normalizeSourceOrigin(options.replacementOrigin)
    : null;
  if (!source || (options.mode === "replace" && !replacement)) return [];

  return channels.flatMap((channel) => {
    if (originOf(channel.stream_url) !== source) return [];
    const backups = channel.backup_stream_urls ?? [];

    if (options.mode === "invert") {
      const [candidate, ...remainingBackups] = backups;
      const firstBackup = candidate?.trim() ? candidate : null;
      return [{
        channel,
        nextStreamUrl: firstBackup ?? null,
        nextBackupStreamUrls: firstBackup ? [channel.stream_url, ...remainingBackups] : backups,
        skippedReason: firstBackup ? null : "missing_backup",
      }];
    }

    const nextStreamUrl = replacement + channel.stream_url.slice(source.length);
    const nextBackupStreamUrls = options.saveOldAsBackup && !backups.includes(channel.stream_url)
      ? [channel.stream_url, ...backups]
      : backups;
    return [{
      channel,
      nextStreamUrl,
      nextBackupStreamUrls,
      skippedReason: null,
    }];
  });
}

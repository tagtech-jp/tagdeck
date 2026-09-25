export interface NicoLiveProgram {
  programId: string;
  communityId: string;
  title: string;
  isLive: boolean;
  viewerCount: number;
  commentCount: number;
  startedAt: Date | null;
}

export class NiconicoApiException extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NiconicoApiException";
  }
}

function parseNicoDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "number") {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  }
  return new Date(String(value));
}

export async function fetchNicoLive(userId: string): Promise<NicoLiveProgram | null> {
  const url = `https://live.nicovideo.jp/watch/user/${userId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new NiconicoApiException(`HTTP ${res.status}`, res.status);
  }

  const html = await res.text();

  const match = html.match(/<script id="embedded-data"\s[^>]*data-props="([^"]+)"/);
  if (!match) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  } catch {
    return null;
  }

  const programSchedule = data?.programSchedule as Record<string, unknown> | undefined;
  const program = (programSchedule?.onAirProgram ?? data?.program) as
    | Record<string, unknown>
    | undefined;
  if (!program) return null;

  const programId = String(program.nicoliveProgramId ?? "");
  const communityId = String(
    (program.socialGroup as Record<string, unknown> | undefined)?.id ??
      (data?.socialGroup as Record<string, unknown> | undefined)?.id ??
      "",
  );
  const title = String(program.title ?? "");
  const isLive = program.status === "ON_AIR";

  const statistics = program.statistics as Record<string, unknown> | undefined;
  const viewerCount = Number(statistics?.watchCount ?? 0);
  const commentCount = Number(statistics?.commentCount ?? 0);

  const scheduledStartTime =
    (program.schedule as Record<string, unknown> | undefined)?.scheduledBeginTime ??
    program.beginTime;
  const startedAt = parseNicoDate(scheduledStartTime);

  return { programId, communityId, title, isLive, viewerCount, commentCount, startedAt };
}

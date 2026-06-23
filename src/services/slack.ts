// Minimal Slack Web API poster for hosted server-side alerts.
//
// Posts as the configured bot identity via chat.postMessage. It is a no-op when
// no token is provided, which keeps local/dev runs and tests hermetic (no
// network). It never throws to callers — failures are returned, not raised.

export interface PostSlackOptions {
  /** Bot token (xoxb-…). When absent the call is a no-op. */
  token?: string | undefined;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export async function postSlackMessage(
  channel: string,
  text: string,
  opts: PostSlackOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const token = opts.token;
  if (!token) return { ok: false, error: "disabled" };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;

  try {
    const response = await fetchImpl(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (body && body.ok === true) return { ok: true };
    return {
      ok: false,
      error: typeof body?.error === "string" ? body.error : `http_${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.slice(0, 120) };
  }
}

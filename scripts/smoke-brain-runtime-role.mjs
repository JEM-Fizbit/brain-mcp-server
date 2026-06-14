import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;

const adminUrl = process.env.BRAIN_REVISION_DATABASE_URL;
if (!adminUrl) {
  throw new Error("BRAIN_REVISION_DATABASE_URL is required");
}

const role = `brain_runtime_smoke_${crypto.randomBytes(4).toString("hex")}`;
const password = crypto.randomBytes(24).toString("base64url");

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runtimeConnectionString() {
  const url = new URL(adminUrl);
  const originalUser = decodeURIComponent(url.username);
  const tenantSuffix = originalUser.includes(".")
    ? originalUser.slice(originalUser.indexOf("."))
    : "";
  url.username = `${role}${tenantSuffix}`;
  url.password = password;
  return url.toString();
}

const admin = new Client({ connectionString: adminUrl });

try {
  await admin.connect();
  await admin.query(
    `create role ${quoteIdent(role)} login password ${quoteLiteral(password)}`
  );
  await admin.query(`grant brain_runtime to ${quoteIdent(role)}`);

  const runtime = new Client({ connectionString: runtimeConnectionString() });
  try {
    await runtime.connect();
    const files = await runtime.query(
      "select count(*)::int as hosted_files from brain.brain_files where brain_id = $1",
      [process.env.BRAIN_ID || "ai-brain-jem"]
    );
    const publicGrants = await runtime.query(
      `
        select count(*)::int as public_grants
        from information_schema.role_table_grants
        where table_schema = 'brain'
          and grantee in ('anon', 'authenticated', 'public')
      `
    );
    console.log(
      JSON.stringify(
        {
          runtimeLoginConnects: true,
          hostedFiles: files.rows[0].hosted_files,
          publicGrants: publicGrants.rows[0].public_grants,
        },
        null,
        2
      )
    );
  } finally {
    await runtime.end().catch(() => undefined);
  }
} finally {
  await admin
    .query(`drop role if exists ${quoteIdent(role)}`)
    .catch(() => undefined);
  await admin.end().catch(() => undefined);
}

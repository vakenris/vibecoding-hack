import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const name = `lifepilot-db-test-${randomUUID().slice(0, 8)}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine",
  );
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
      ready = true;
      break;
    } catch {
      await setTimeout(500);
    }
  }
  if (!ready) throw new Error("Test PostgreSQL did not start");
  const bootstrap = `
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to authenticated, service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `;
  const migration = readFileSync(
    new URL("../supabase/migrations/202610250001_initial.sql", import.meta.url),
    "utf8",
  );
  const checks = `
    insert into auth.users values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
    insert into public.user_state(user_id,state) values
      ('10000000-0000-4000-8000-000000000001','{"version":1,"points":0}'),
      ('10000000-0000-4000-8000-000000000002','{"version":1,"points":200}');
    set role authenticated;
    select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
    do $$ begin
      if (select count(*) from public.user_state) <> 1 then raise exception 'RLS exposed another user'; end if;
      if (select state->>'points' from public.user_state) <> '0' then raise exception 'Wrong owner'; end if;
      begin
        update public.user_state set state='{"version":1,"points":9999}';
        raise exception 'Client write unexpectedly allowed';
      exception when insufficient_privilege then null; end;
      begin
        delete from public.user_state;
        raise exception 'Client deletion unexpectedly allowed';
      exception when insufficient_privilege then null; end;
    end $$;
    reset role; set role anon;
    do $$ begin
      begin perform * from public.user_state; raise exception 'Anonymous read unexpectedly allowed';
      exception when insufficient_privilege then null; end;
    end $$;
    reset role; set role service_role;
    do $$ declare n integer; begin
      update public.user_state set state='{"version":1,"points":10,"completed":["step"]}', revision=1 where user_id='10000000-0000-4000-8000-000000000001' and revision=0;
      get diagnostics n = row_count;
      if n <> 1 then raise exception 'First CAS failed'; end if;
      update public.user_state set state='{"version":1,"points":20}', revision=1 where user_id='10000000-0000-4000-8000-000000000001' and revision=0;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'Stale CAS unexpectedly succeeded'; end if;
      if (select state->>'points' from public.user_state where user_id='10000000-0000-4000-8000-000000000001') <> '10' then raise exception 'Duplicate award'; end if;
    end $$;
    reset role;
    delete from auth.users where id='10000000-0000-4000-8000-000000000001';
    do $$ begin if (select count(*) from public.user_state) <> 1 then raise exception 'Account cascade failed'; end if; end $$;
  `;
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      input: bootstrap + migration + checks,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  console.log(
    "PASS: PostgreSQL migration, owner isolation, anonymous denial, client write denial, revision CAS, account cascade.",
  );
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  try {
    docker("rm", "--force", name);
  } catch {
    /* Container may not have started. */
  }
}

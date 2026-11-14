/**
 * Manage who can sign in.
 *
 *   pnpm users add <id> <email> [name] [--admin] [--mode=scholarships]   create an account and print an invite link
 *   pnpm users mode <id> jobs|scholarships        what the account looks for
 *   pnpm users invite <id>                         a fresh invite link (also resets a forgotten password)
 *   pnpm users password <id>                       set a password now (reads it from stdin)
 *   pnpm users email <id> <new email>                change the sign-in email
 *   pnpm users list
 *   pnpm users disable <id> | enable <id>
 *   pnpm users remove <id>                         delete the account; its library moves to _winnow/removed/
 *
 * Restart the server after `remove` so it lets go of that library.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig, loadDotEnv } from '../config.ts';
import { openSpace } from '../space.ts';
import { setMode } from '../study/mode.ts';
import { Users } from '../users.ts';

loadDotEnv();
const config = loadConfig();
const users = new Users(config.stateDir);
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const base = process.env.WINNOW_PUBLIC_URL ?? `http://localhost:${config.port}`;
const link = (token: string) => `${base}/welcome?invite=${encodeURIComponent(token)}`;

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

try {
  switch (cmd) {
    case 'add': {
      const [id, email, ...name] = args;
      if (!id || !email) throw new Error('Usage: pnpm users add <id> <email> [name] [--admin]');
      const admin = flags.has('--admin') || users.list().length === 0;
      const user = users.add({ id, email, name: name.join(' ') || id, admin });
      const space = openSpace(config.usersDir, user.id);
      const mode = [...flags].find((f) => f.startsWith('--mode='))?.slice(7);
      if (mode) setMode(space.db, mode);
      space.db.close();
      if (mode) console.log(`Mode: ${mode}.`);
      console.log(`Added ${user.id} <${user.email}>${user.admin ? ' (admin)' : ''}.`);
      console.log(`Invite link (valid 14 days): ${link(users.invite(user.id))}`);
      break;
    }
    case 'invite': {
      const [id] = args;
      if (!id || !users.get(id)) throw new Error('Usage: pnpm users invite <id>');
      console.log(`Invite link (valid 14 days): ${link(users.invite(id))}`);
      break;
    }
    case 'password': {
      const [id] = args;
      if (!id || !users.get(id)) throw new Error('Usage: pnpm users password <id>');
      await users.setPassword(id, await readSecret('New password: '));
      console.log(`Password set for ${id}.`);
      break;
    }
    case 'mode': {
      const [id, mode] = args;
      if (!id || !mode || !users.get(id))
        throw new Error('Usage: pnpm users mode <id> jobs|scholarships');
      const space = openSpace(config.usersDir, id);
      setMode(space.db, mode);
      space.db.close();
      console.log(`${id} now looks for ${mode}. Restart the server so it picks this up.`);
      break;
    }
    case 'email': {
      const [id, email] = args;
      if (!id || !email || !users.get(id))
        throw new Error('Usage: pnpm users email <id> <new email>');
      users.setEmail(id, email);
      console.log(`${id} now signs in as ${email}.`);
      break;
    }
    case 'disable':
    case 'enable': {
      const [id] = args;
      if (!id || !users.get(id)) throw new Error(`Usage: pnpm users ${cmd} <id>`);
      users.setDisabled(id, cmd === 'disable');
      console.log(`${id} ${cmd}d.`);
      break;
    }
    case 'remove': {
      const [id] = args;
      if (!id || !users.get(id)) throw new Error('Usage: pnpm users remove <id>');
      users.remove(id);
      const library = join(config.usersDir, id);
      if (existsSync(library)) {
        const removed = join(config.stateDir, 'removed');
        mkdirSync(removed, { recursive: true });
        const to = join(removed, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        renameSync(library, to);
        console.log(`Removed ${id}. Their library is in ${to}. Restart the server.`);
      } else console.log(`Removed ${id}. Restart the server.`);
      break;
    }
    case 'list':
    case undefined: {
      const list = users.list();
      if (!list.length) console.log('No users yet. Add one: pnpm users add <id> <email> [name]');
      for (const u of list)
        console.log(
          `${u.id}\t${u.email}\t${u.name}${u.admin ? '\tadmin' : ''}${u.disabled ? '\tdisabled' : ''}${u.hasPassword ? '' : '\t(no password yet)'}`,
        );
      break;
    }
    default:
      throw new Error(
        `Unknown command "${cmd}". Try: add, invite, password, email, list, disable, enable, remove.`,
      );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  users.close();
}

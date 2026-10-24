import { describe, expect, it } from 'vitest';
import { hashPassword, Users, verifyPassword } from './users.ts';

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong horse battery', h)).toBe(false);
  });
});

describe('Users', () => {
  it('invites, accepts once, logs in and keeps a session', async () => {
    const users = new Users(':memory:');
    users.add({ id: 'yinka', email: 'yinka@example.test', name: 'Yinka', admin: true });
    const invite = users.invite('yinka');
    expect(users.inviteUser(invite)?.id).toBe('yinka');
    await users.acceptInvite(invite, 'a long enough password');
    await expect(users.acceptInvite(invite, 'another long password')).rejects.toThrow(
      /expired or was used/,
    );
    const { token, user } = await users.login('YINKA@example.test', 'a long enough password');
    expect(user.id).toBe('yinka');
    expect((await users.login('YINKA', 'a long enough password')).user.id).toBe('yinka');
    expect(users.session(token)?.id).toBe('yinka');
    users.logout(token);
    expect(users.session(token)).toBeNull();
  });

  it('rejects short passwords and slows down guessing', async () => {
    const users = new Users(':memory:');
    users.add({ id: 'anna', email: 'a@example.test', name: 'A' });
    await expect(users.setPassword('anna', 'short')).rejects.toThrow(/10 characters/);
    await users.setPassword('anna', 'a long enough password');
    for (let i = 0; i < 5; i++)
      await expect(users.login('a@example.test', 'nope nope nope')).rejects.toThrow(/don’t match/);
    await expect(users.login('a@example.test', 'a long enough password')).rejects.toThrow(
      /Too many/,
    );
  });

  it('signs a disabled person out', async () => {
    const users = new Users(':memory:');
    users.add({ id: 'bola', email: 'b@example.test', name: 'B' });
    await users.setPassword('bola', 'a long enough password');
    const { token } = await users.login('b@example.test', 'a long enough password');
    users.setDisabled('bola', true);
    expect(users.session(token)).toBeNull();
  });
});

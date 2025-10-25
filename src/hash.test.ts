import { recentMessagesHash, shouldReuseSummary } from './hash';

function msg(role: string, text: string){ return { role, text }; }

describe('recentMessagesHash', () => {
  test('identical content with whitespace variations yields same hash', () => {
    const a = recentMessagesHash([
      msg('User', ' Hello   world\n'),
      msg('Assistant', 'How are   you?'),
      msg('User', 'Fine')
    ]);
    const b = recentMessagesHash([
      msg('user', 'Hello world'), // role case & collapsed spaces
      msg('assistant', 'How are you?'),
      msg('user', 'Fine')
    ]);
    expect(a).toBe(b);
  });

  test('role or text changes alter hash', () => {
    const base = recentMessagesHash([ msg('user','hi'), msg('assistant','there') ]);
    const changedRole = recentMessagesHash([ msg('assistant','hi'), msg('assistant','there') ]);
    const changedText = recentMessagesHash([ msg('user','hi!'), msg('assistant','there') ]);
    expect(base).not.toBe(changedRole);
    expect(base).not.toBe(changedText);
  });
});

describe('shouldReuseSummary', () => {
  test('reuse true only when hashes match', () => {
    const messages = [ msg('user','hi'), msg('assistant','there') ];
    const h = recentMessagesHash(messages);
    const { reuse } = shouldReuseSummary(h, messages);
    expect(reuse).toBe(true);
    const { reuse: reuse2 } = shouldReuseSummary('deadbeef', messages);
    expect(reuse2).toBe(false);
  });
});

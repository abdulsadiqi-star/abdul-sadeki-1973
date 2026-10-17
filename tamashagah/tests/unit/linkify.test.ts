import { describe, expect, it } from 'vitest';
import { hashtagSearchHref, tokenizeText, toSafeHref, type TextToken } from '@/features/watch/linkify';

const kinds = (tokens: TextToken[]) => tokens.map((t) => `${t.type}:${t.value}`);

describe('urls', () => {
  it('links http(s) and www addresses inside Persian text', () => {
    expect(kinds(tokenizeText('لینک دستور: https://example.com/recipe?id=12 را ببینید'))).toEqual([
      'text:لینک دستور: ',
      'url:https://example.com/recipe?id=12',
      'text: را ببینید',
    ]);
    const [, www] = tokenizeText('سایت www.example.com عالی است');
    expect(www).toEqual({ type: 'url', value: 'www.example.com', href: 'https://www.example.com/' });
  });

  it('drops sentence punctuation glued to the end of a URL (Latin and Persian)', () => {
    expect(kinds(tokenizeText('ببینید https://a.com/x.'))).toEqual(['text:ببینید ', 'url:https://a.com/x', 'text:.']);
    expect(kinds(tokenizeText('https://a.com/x، سپس'))).toEqual(['url:https://a.com/x', 'text:، سپس']);
    expect(kinds(tokenizeText('(https://a.com/x)'))).toEqual(['text:(', 'url:https://a.com/x', 'text:)']);
    expect(kinds(tokenizeText('«https://a.com/x»؟'))).toEqual(['text:«', 'url:https://a.com/x', 'text:»؟']);
    expect(kinds(tokenizeText('https://a.com/x?!'))).toEqual(['url:https://a.com/x', 'text:?!']);
  });

  it('keeps a closing parenthesis that belongs to the URL', () => {
    expect(kinds(tokenizeText('https://en.wikipedia.org/wiki/Tea_(drink) خوب است'))).toEqual(['url:https://en.wikipedia.org/wiki/Tea_(drink)', 'text: خوب است']);
  });

  it('never turns dangerous or non-web schemes into links', () => {
    for (const evil of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/file',
      'mailto:someone@example.com',
      'tel:+989121234567',
      '//evil.example/path',
    ]) {
      const tokens = tokenizeText(`قبل ${evil} بعد`);
      expect(tokens.filter((t) => t.type === 'url'), evil).toEqual([]);
      expect(tokens.map((t) => t.value).join(''), evil).toBe(`قبل ${evil} بعد`); // text is preserved verbatim
    }
  });

  it('rejects userinfo tricks, hostless and malformed URLs', () => {
    expect(toSafeHref('https://trusted.com@evil.com/')).toBeNull();
    expect(toSafeHref('https://user:pass@host.com')).toBeNull();
    expect(toSafeHref('http://intranet/')).toBeNull();
    expect(toSafeHref('https://')).toBeNull();
    expect(toSafeHref('https://exa mple.com')).toBeNull();
    expect(toSafeHref(`https://a.com/${'x'.repeat(2100)}`)).toBeNull();
    expect(toSafeHref('http://localhost:3000/watch/x')).toBe('http://localhost:3000/watch/x');
    expect(toSafeHref('HTTPS://EXAMPLE.COM/A')).toBe('https://example.com/A'); // normalized
  });

  it('does not let a link swallow markup characters', () => {
    expect(kinds(tokenizeText('<a href="https://a.com">x</a>'))).toEqual(['text:<a href="', 'url:https://a.com', 'text:">x</a>']);
  });
});

describe('hashtags', () => {
  it('finds Persian and Latin hashtags, including ZWNJ inside', () => {
    expect(kinds(tokenizeText('طرز تهیه #پلو و #ته‌دیگ #Persian_food'))).toEqual([
      'text:طرز تهیه ',
      'hashtag:#پلو',
      'text: و ',
      'hashtag:#ته‌دیگ',
      'text: ',
      'hashtag:#Persian_food',
    ]);
    expect(tokenizeText('#آشپزی')[0]).toEqual({ type: 'hashtag', value: '#آشپزی', tag: 'آشپزی' });
  });

  it('accepts hashtags after punctuation and stops at punctuation', () => {
    expect(kinds(tokenizeText('(#پلو)، #کباب.'))).toEqual(['text:(', 'hashtag:#پلو', 'text:)، ', 'hashtag:#کباب', 'text:.']);
  });

  it('ignores number-only tags, word#tag, lone hashes and over-long tags', () => {
    expect(tokenizeText('شماره #1 و #123 و a#b و # و ##').filter((t) => t.type === 'hashtag')).toEqual([]);
    expect(tokenizeText(`#${'ا'.repeat(60)}`).filter((t) => t.type === 'hashtag')).toEqual([]);
    expect(tokenizeText(`#${'ا'.repeat(50)}`).filter((t) => t.type === 'hashtag')).toHaveLength(1);
  });

  it('does not treat a URL fragment as a hashtag', () => {
    expect(kinds(tokenizeText('https://example.com/page#section و #برچسب'))).toEqual(['url:https://example.com/page#section', 'text: و ', 'hashtag:#برچسب']);
  });

  it('builds the search link from the bare tag', () => {
    expect(hashtagSearchHref('آشپزی')).toBe('/search?q=%D8%A2%D8%B4%D9%BE%D8%B2%DB%8C');
    expect(hashtagSearchHref('a b&c=d')).toBe('/search?q=a%20b%26c%3Dd');
  });
});

describe('plain text and robustness', () => {
  it('returns the text untouched when there is nothing to link', () => {
    expect(tokenizeText('')).toEqual([]);
    expect(tokenizeText('فقط یک متن ساده\nبا دو خط')).toEqual([{ type: 'text', value: 'فقط یک متن ساده\nبا دو خط' }]);
  });

  it('keeps HTML as inert text (the renderer escapes it)', () => {
    const text = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    expect(tokenizeText(text)).toEqual([{ type: 'text', value: text }]);
  });

  it('reassembles to the original text for any mix of tokens', () => {
    const text = 'سلام #دنیا https://a.com/x، و www.b.org! javascript:alert(1) #پایان';
    expect(tokenizeText(text).map((t) => t.value).join('')).toBe(text);
  });

  it('handles huge and pathological inputs quickly', () => {
    const started = performance.now();
    tokenizeText('http://' + 'a'.repeat(100_000));
    tokenizeText('#' + 'ا'.repeat(100_000));
    tokenizeText(('https://a.com/' + '('.repeat(50)).repeat(500));
    tokenizeText('x'.repeat(200_000));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(tokenizeText('x'.repeat(30_000))).toHaveLength(1);
  });
});

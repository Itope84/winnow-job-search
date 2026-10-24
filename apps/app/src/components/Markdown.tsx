import type { ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, space, useTheme } from '@/theme';

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+|\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)/g;

/**
 * Markdown for reports and job descriptions: headings, paragraphs, lists, tables, quotes, code, bold,
 * italic and links. Reading text uses the serif; tables and code use the interface faces.
 */
export function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  const { c } = useTheme();
  const body = compact
    ? { fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 22, color: c.ink }
    : { fontFamily: fonts.content, fontSize: 16.5, lineHeight: 26, color: c.ink };

  const inline = (s: string, key: string): ReactNode[] =>
    s.split(INLINE).map((part, i) => {
      const k = `${key}-${i}`;
      if (!part) return null;
      if (part.startsWith('**') && part.endsWith('**'))
        return (
          <Text key={k} style={{ fontFamily: compact ? fonts.uiSemibold : fonts.contentMedium }}>
            {part.slice(2, -2)}
          </Text>
        );
      if (part.startsWith('`') && part.endsWith('`'))
        return (
          <Text
            key={k}
            style={{ fontFamily: fonts.mono, fontSize: 13, backgroundColor: c.surface }}
          >
            {part.slice(1, -1)}
          </Text>
        );
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link || /^https?:\/\//.test(part)) {
        const url = link ? (link[2] as string) : part;
        return (
          <Text
            key={k}
            style={{ color: c.primaryInk, textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(url)}
          >
            {link ? link[1] : part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
          </Text>
        );
      }
      if (
        (part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))
      )
        return (
          <Text
            key={k}
            style={{
              fontFamily: compact ? fonts.ui : fonts.contentItalic,
              fontStyle: compact ? 'italic' : 'normal',
            }}
          >
            {part.slice(1, -1)}
          </Text>
        );
      return part;
    });

  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const k = `b${key++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++;
      out.push(
        <ScrollView key={k} horizontal style={[styles.code, { backgroundColor: c.surface }]}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18, color: c.ink }}>
            {code.join('\n')}
          </Text>
        </ScrollView>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = (h[1] as string).length;
      out.push(
        <Text
          key={k}
          style={{
            fontFamily: level <= 2 ? fonts.contentMedium : fonts.uiSemibold,
            fontSize: level === 1 ? 24 : level === 2 ? 20 : 15,
            lineHeight: level === 1 ? 30 : level === 2 ? 26 : 21,
            color: c.ink,
            marginTop: out.length ? space.lg : 0,
            marginBottom: space.sm,
          }}
        >
          {inline(h[2] as string, k)}
        </Text>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(
        <View
          key={k}
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: c.rule,
            marginVertical: space.md,
          }}
        />,
      );
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const cells = (lines[i] ?? '')
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((x) => x.trim());
        if (!cells.every((x) => /^:?-{2,}:?$/.test(x))) rows.push(cells);
        i++;
      }
      out.push(
        <View key={k} style={[styles.table, { borderColor: c.rule }]}>
          {rows.map((cells, r) => (
            <View
              key={`${k}-${r}`}
              style={{
                flexDirection: 'row',
                borderTopWidth: r ? StyleSheet.hairlineWidth : 0,
                borderColor: c.rule,
                backgroundColor: r === 0 ? c.surface : 'transparent',
              }}
            >
              {cells.map((cell, ci) => (
                <Text
                  key={`${k}-${r}-${ci}`}
                  style={{
                    flex: ci === cells.length - 1 && cells.length > 2 ? 2 : 1,
                    padding: 8,
                    fontFamily: r === 0 ? fonts.uiSemibold : fonts.ui,
                    fontSize: 13,
                    lineHeight: 19,
                    color: c.ink,
                  }}
                >
                  {inline(cell, `${k}-${r}-${ci}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>,
      );
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items: { n: string | null; text: string; indent: number }[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i] ?? '')) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i] ?? '') as RegExpExecArray;
        items.push({
          n: /\d/.test(m[2] as string) ? (m[2] as string) : null,
          text: m[3] as string,
          indent: Math.min(2, Math.floor((m[1] as string).length / 2)),
        });
        i++;
      }
      out.push(
        <View key={k} style={{ gap: 4, marginBottom: space.sm }}>
          {items.map((it, n) => (
            <View
              key={`${k}-${n}`}
              style={{ flexDirection: 'row', gap: 8, paddingLeft: it.indent * 16 }}
            >
              <Text style={[body, { color: c.lead, width: it.n ? 22 : 12 }]}>{it.n ?? '•'}</Text>
              <Text style={[body, { flex: 1 }]}>{inline(it.text, `${k}-${n}`)}</Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>'))
        quote.push((lines[i++] ?? '').replace(/^>\s?/, ''));
      out.push(
        <View
          key={k}
          style={{
            borderLeftWidth: 3,
            borderLeftColor: c.ruleStrong,
            paddingLeft: space.md,
            marginBottom: space.md,
          }}
        >
          <Text style={[body, { color: c.lead }]}>{inline(quote.join(' '), k)}</Text>
        </View>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s+|>|\|)/.test(lines[i] ?? '')
    )
      para.push((lines[i++] ?? '').trim());
    // Lines that start with a bold label ("**Date:** …") stay on their own line.
    const joined = para.reduce(
      (acc, l, n) => (n === 0 ? l : `${acc}${l.startsWith('**') ? '\n' : ' '}${l}`),
      '',
    );
    out.push(
      <Text key={k} style={[body, { marginBottom: space.md }]}>
        {inline(joined, k)}
      </Text>,
    );
  }
  return <View>{out}</View>;
}

const styles = StyleSheet.create({
  code: { borderRadius: radius.base, padding: space.sm, marginBottom: space.md },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.base,
    marginBottom: space.md,
    overflow: 'hidden',
  },
});

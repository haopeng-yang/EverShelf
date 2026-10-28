import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { pickBookFile, saveImportedBook, UnsupportedFileError, type PickedBookFile } from '@/books/importBook';
import { EpubError } from '@/books/parseEpub';
import { CHAPTER_LENGTH, parseTxt, type ParsedChapter, type SplitRule } from '@/books/parseTxt';
import { Button } from '@/components/Button';
import { showMessage } from '@/components/dialogs';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import type { Translate } from '@/i18n';
import { useT } from '@/i18n/useT';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** How many chapter titles the preview lists before "and N more". */
const PREVIEW_CHAPTERS = 30;

/**
 * Import a .txt or .epub book onto a shelf: pick a file, check how it was
 * split into chapters, fix the title or author, then save it as a new item.
 */
export default function ImportScreen() {
  const { shelfId } = useLocalSearchParams<{ shelfId: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const db = useSQLiteContext();
  const t = useT();
  const styles = useStyles();
  const shelf = state.shelves.find((s) => s.id === shelfId);

  const [file, setFile] = useState<PickedBookFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [rule, setRule] = useState<SplitRule>('headings');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // TXT files are split here, so changing the rule re-splits; EPUBs come with their chapters.
  const txt = useMemo(() => (file?.kind === 'txt' ? parseTxt(file.text, file.name, rule) : null), [file, rule]);
  const chapters = useMemo(() => {
    const raw = file?.kind === 'epub' ? file.book.chapters : (txt?.chapters ?? []);
    return withTitles(raw, t);
  }, [file, txt, t]);

  async function choose() {
    setPicking(true);
    try {
      const picked = await pickBookFile();
      if (!picked) return;
      const meta = picked.kind === 'epub' ? picked.book : parseTxt(picked.text, picked.name, 'headings');
      setFile(picked);
      setRule('headings');
      setTitle(meta.title || picked.name.replace(/\.\w+$/, ''));
      setAuthor(meta.author);
    } catch (error) {
      showMessage(errorText(error, t));
    } finally {
      setPicking(false);
    }
  }

  // Open the picker straight away; there is nothing to show until a file is chosen.
  const openedOnce = useRef(false);
  const openPickerOnce = useEffectEvent(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    void choose();
  });
  useEffect(() => openPickerOnce(), []);

  if (!shelf) return <NotFound what="shelf" />;
  const saving = progress !== null;

  async function save() {
    if (!shelf || !file || saving) return;
    if (!title.trim()) {
      showMessage(t('itemEdit.needTitle'));
      return;
    }
    if (chapters.length === 0) {
      showMessage(t('import.empty'));
      return;
    }
    setProgress({ done: 0, total: chapters.length });
    try {
      const epub = file.kind === 'epub' ? file.book : null;
      const item = await saveImportedBook(
        db,
        dispatch,
        {
          shelf,
          title: title.trim(),
          tagValues: { [t('tag.author')]: author, [t('tag.description')]: epub?.description ?? '' },
          cover: epub?.cover ?? null,
          chapters,
        },
        (done, total) => setProgress({ done, total }),
      );
      router.replace({ pathname: '/item/[id]', params: { id: item.id } });
    } catch (error) {
      setProgress(null);
      showMessage(t('import.saveFailed', { error: String(error) }));
    }
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={spacing.xl}>
      <Stack.Screen
        options={{
          title: t('import.title', { shelf: shelf.name }),
          headerRight: () => (
            <Button title={t('common.save')} variant="text" compact disabled={!file || saving} onPress={save} />
          ),
        }}
      />

      {saving ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.hint}>{t('import.saving', { done: progress.done, total: progress.total })}</Text>
        </View>
      ) : !file ? (
        <View style={styles.center}>
          {picking ? <ActivityIndicator /> : <Text style={styles.hint}>{t('import.intro')}</Text>}
          <Button title={t('import.chooseFile')} variant="primary" disabled={picking} onPress={choose} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.label}>{t('import.file')}</Text>
            <Text style={styles.value}>{file.name}</Text>
            {file.kind === 'txt' && (
              <Text style={styles.hint}>{t('import.encoding', { encoding: file.encoding.toUpperCase() })}</Text>
            )}
            {file.kind === 'epub' && file.book.cover && <Text style={styles.hint}>{t('import.hasCover')}</Text>}
            <Button title={t('import.chooseOther')} compact onPress={choose} style={styles.alignStart} />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>{t('tag.title')}</Text>
            <TextField value={title} onChangeText={setTitle} placeholder={t('itemEdit.titlePlaceholder')} />
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>{t('tag.author')}</Text>
            <TextField value={author} onChangeText={setAuthor} />
          </View>

          {txt && (
            <View style={styles.section}>
              <Text style={styles.label}>{t('import.splitBy')}</Text>
              <View style={styles.ruleRow}>
                <Button
                  title={t('import.byHeadings', { count: txt.headingCount })}
                  variant={txt.rule === 'headings' ? 'primary' : 'secondary'}
                  compact
                  disabled={txt.headingCount < 2}
                  onPress={() => setRule('headings')}
                  style={styles.ruleButton}
                />
                <Button
                  title={t('import.byLength', { length: CHAPTER_LENGTH.toLocaleString() })}
                  variant={txt.rule === 'length' ? 'primary' : 'secondary'}
                  compact
                  onPress={() => setRule('length')}
                  style={styles.ruleButton}
                />
              </View>
              {txt.headingCount < 2 && <Text style={styles.hint}>{t('import.noHeadings')}</Text>}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.label}>{t('import.chapters', { count: chapters.length })}</Text>
            <View style={styles.chapterList}>
              {chapters.slice(0, PREVIEW_CHAPTERS).map((chapter, index) => (
                <View key={index} style={styles.chapterRow}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>
                    {chapter.title}
                  </Text>
                  <Text style={styles.hint}>{t('import.chars', { count: chapter.text.length })}</Text>
                </View>
              ))}
              {chapters.length > PREVIEW_CHAPTERS && (
                <Text style={styles.hint}>{t('import.more', { count: chapters.length - PREVIEW_CHAPTERS })}</Text>
              )}
            </View>
          </View>
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

/** Gives untitled chapters a name: the text before the first heading, or numbered parts. */
function withTitles(chapters: ParsedChapter[], t: Translate): ParsedChapter[] {
  return chapters.map((chapter, index) => {
    if (chapter.title) return chapter;
    const isOpening = index === 0 && chapters.length > 1 && chapters[1].title !== '';
    return { ...chapter, title: isOpening ? t('import.opening') : t('import.part', { n: index + 1 }) };
  });
}

function errorText(error: unknown, t: Translate): string {
  if (error instanceof UnsupportedFileError) return t('import.unsupported', { name: error.message });
  if (error instanceof EpubError) {
    if (error.code === 'drm') return t('import.epubDrm');
    if (error.code === 'noText') return t('import.epubNoText');
    return t('import.epubInvalid');
  }
  return t('import.readFailed', { error: String(error) });
}

const useStyles = makeStyles((c) => ({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xl * 2 },
  center: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl * 2 },
  section: { gap: spacing.sm },
  label: { fontSize: fontSize.small, color: c.textMuted, fontWeight: '600' },
  value: { fontSize: fontSize.body, color: c.text },
  hint: { fontSize: fontSize.small, color: c.textMuted, textAlign: 'center' },
  alignStart: { alignSelf: 'flex-start' },
  ruleRow: { flexDirection: 'row', gap: spacing.sm },
  ruleButton: { flex: 1 },
  chapterList: { borderRadius: radius.md, backgroundColor: c.surface, padding: spacing.md, gap: spacing.sm },
  chapterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chapterTitle: { flex: 1, fontSize: fontSize.body, color: c.text },
}));

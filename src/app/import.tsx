import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { guessReadingMode } from '@/books/comic/parseComic';
import { ZipError } from '@/books/comic/zip';
import { MixedFilesError, pickBookFile, saveImportedBook, UnsupportedFileError, type PickedBookFile } from '@/books/importBook';
import { ComicError, disposeComic, saveImportedComic } from '@/books/importComic';
import { EpubError } from '@/books/parseEpub';
import { CHAPTER_LENGTH, parseTxt, type ParsedChapter, type SplitRule } from '@/books/parseTxt';
import { Button } from '@/components/Button';
import { showMessage } from '@/components/dialogs';
import { LockedScreen } from '@/components/LockedShelf';
import { NotFound } from '@/components/NotFound';
import { TextField } from '@/components/TextField';
import type { Translate } from '@/i18n';
import { useT } from '@/i18n/useT';
import type { ReadingMode } from '@/models/types';
import { useShelfLocks } from '@/state/ShelfLockProvider';
import { useShelfDispatch, useShelfState } from '@/state/ShelfProvider';
import { fontSize, makeStyles, radius, spacing } from '@/theme';

/** How many chapter titles the preview lists before "and N more". */
const PREVIEW_CHAPTERS = 30;

const READING_MODES: ReadingMode[] = ['ltr', 'rtl', 'vertical'];

/**
 * Import a .txt or .epub book, or one or more comic files, onto a shelf: pick
 * the file(s), check the chapters, fix the title or author (and a comic's
 * reading direction), then save it as a new item.
 */
export default function ImportScreen() {
  const { shelfId } = useLocalSearchParams<{ shelfId: string }>();
  const state = useShelfState();
  const dispatch = useShelfDispatch();
  const db = useSQLiteContext();
  const t = useT();
  const styles = useStyles();
  const shelf = state.shelves.find((s) => s.id === shelfId);
  const { isLocked } = useShelfLocks();

  const [file, setFile] = useState<PickedBookFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [rule, setRule] = useState<SplitRule>('headings');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [readingMode, setReadingMode] = useState<ReadingMode>('ltr');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Comics may have copied a file to the cache while picking; drop it when it's replaced or the screen closes.
  useEffect(() => {
    if (file?.kind !== 'comic') return;
    return () => disposeComic(file.comic);
  }, [file]);

  // TXT files are split here, so changing the rule re-splits; EPUBs come with their chapters.
  const txt = useMemo(() => (file?.kind === 'txt' ? parseTxt(file.text, file.name, rule) : null), [file, rule]);
  const chapters = useMemo(() => {
    const raw = file?.kind === 'epub' ? file.book.chapters : (txt?.chapters ?? []);
    return withTitles(raw, t);
  }, [file, txt, t]);
  // What the chapter list shows: a title and a size, for books and comics alike.
  const chapterRows = useMemo(
    () =>
      file?.kind === 'comic'
        ? file.comic.chapters.map((c, index) => ({
            title: c.title || t('import.chapterN', { n: index + 1 }),
            size: t('import.pages', { count: c.pages.length }),
          }))
        : chapters.map((c) => ({ title: c.title, size: t('import.chars', { count: c.text.length }) })),
    [file, chapters, t],
  );

  async function choose() {
    setPicking(true);
    try {
      const picked = await pickBookFile();
      if (!picked) return;
      setFile(picked);
      setRule('headings');
      if (picked.kind === 'comic') {
        const { comic } = picked;
        setTitle(comic.title);
        setAuthor(comic.author);
        setReadingMode(guessReadingMode({ rightToLeft: comic.rightToLeft, shelfId: shelfId ?? '', sizes: comic.sampleSizes }));
        return;
      }
      const meta = picked.kind === 'epub' ? picked.book : parseTxt(picked.text, picked.name, 'headings');
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
  if (isLocked(shelf)) return <LockedScreen shelf={shelf} />;
  const saving = progress !== null;

  async function save() {
    if (!shelf || !file || saving) return;
    if (!title.trim()) {
      showMessage(t('itemEdit.needTitle'));
      return;
    }
    if (chapterRows.length === 0) {
      showMessage(t('import.empty'));
      return;
    }
    if (file.kind === 'comic') {
      setProgress({ done: 0, total: file.comic.pageCount });
      try {
        const item = await saveImportedComic(
          db,
          dispatch,
          {
            shelf,
            title: title.trim(),
            tagValues: { [t('tag.author')]: author, [t('tag.description')]: file.comic.description },
            comic: file.comic,
            readingMode,
            chapterTitles: chapterRows.map((row) => row.title),
          },
          (done, total) => setProgress({ done, total }),
        );
        router.replace({ pathname: '/item/[id]', params: { id: item.id } });
      } catch (error) {
        setProgress(null);
        showMessage(error instanceof ComicError ? errorText(error, t) : t('import.saveFailed', { error: String(error) }));
      }
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
          <Text style={styles.hint}>
            {t(file?.kind === 'comic' ? 'import.savingPages' : 'import.saving', { done: progress.done, total: progress.total })}
          </Text>
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
            <Text style={styles.value}>{file.name || t('import.noFileName')}</Text>
            {file.kind === 'txt' && (
              <Text style={styles.hint}>{t('import.encoding', { encoding: file.encoding.toUpperCase() })}</Text>
            )}
            {file.kind === 'epub' && file.book.cover && <Text style={styles.hint}>{t('import.hasCover')}</Text>}
            {file.kind === 'comic' && (
              <Text style={styles.hint}>
                {[
                  file.comic.files.length > 1 ? t('import.files', { count: file.comic.files.length }) : '',
                  t('import.pages', { count: file.comic.pageCount }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
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

          {file.kind === 'comic' && (
            <View style={styles.section}>
              <Text style={styles.label}>{t('import.readingMode')}</Text>
              {READING_MODES.map((mode) => (
                <Button
                  key={mode}
                  title={`${t(`readingMode.${mode}`)} · ${t(`readingMode.${mode}Hint`)}`}
                  variant={readingMode === mode ? 'primary' : 'secondary'}
                  compact
                  onPress={() => setReadingMode(mode)}
                />
              ))}
              <Text style={styles.hint}>{t('import.readingModeHint')}</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.label}>{t('import.chapters', { count: chapterRows.length })}</Text>
            <View style={styles.chapterList}>
              {chapterRows.slice(0, PREVIEW_CHAPTERS).map((chapter, index) => (
                <View key={index} style={styles.chapterRow}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>
                    {chapter.title}
                  </Text>
                  <Text style={styles.hint}>{chapter.size}</Text>
                </View>
              ))}
              {chapterRows.length > PREVIEW_CHAPTERS && (
                <Text style={styles.hint}>{t('import.more', { count: chapterRows.length - PREVIEW_CHAPTERS })}</Text>
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
  if (error instanceof UnsupportedFileError) {
    return error.message ? t('import.unsupported', { name: error.message }) : t('import.unsupportedUnnamed');
  }
  if (error instanceof MixedFilesError) return t('import.mixedFiles');
  if (error instanceof ComicError) return t(error.code === 'noSpace' ? 'import.comicNoSpace' : 'import.comicNoPages');
  if (error instanceof ZipError) {
    if (error.code === 'tooLarge') return t('import.comicTooLarge');
    if (error.code === 'encrypted') return t('import.comicEncrypted');
    if (error.code === 'unsupported') return t('import.comicUnsupported');
    return t('import.comicDamaged');
  }
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

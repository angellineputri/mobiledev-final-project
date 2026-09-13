import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radii, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addCategory, deleteCategory, getCategories, updateCategory } from '@/storage/storage';
import { isProtectedCategory } from '@/data/defaultCategories';

type Category = { id: string; name: string; kind?: string; isDefault: boolean };
type Tab = 'expense' | 'income';

function AddRow({
  value,
  onChange,
  onAdd,
  adding,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  adding: boolean;
  t: ReturnType<typeof import('@/hooks/use-theme').useTheme>;
}) {
  return (
    <View style={[rowStyles.addRow, { borderColor: t.border }]}>
      <TextInput
        style={[rowStyles.addInput, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
        placeholder="New category name"
        placeholderTextColor={t.muted}
        value={value}
        onChangeText={onChange}
        returnKeyType="done"
        onSubmitEditing={onAdd}
      />
      <Pressable
        style={[rowStyles.addBtn, { backgroundColor: t.accent }, (adding || !value.trim()) && rowStyles.dimmed]}
        onPress={onAdd}
        disabled={adding || !value.trim()}
      >
        {adding
          ? <ActivityIndicator size="small" color={t.onAccent} />
          : <Text style={[rowStyles.addBtnText, { color: t.onAccent }]}>Add</Text>}
      </Pressable>
    </View>
  );
}

function CategoryRow({
  cat,
  deletingId,
  editingId,
  editDraft,
  savingId,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onDelete,
  t,
}: {
  cat: Category;
  deletingId: string | null;
  editingId: string | null;
  editDraft: string;
  savingId: string | null;
  onEditStart: (cat: Category) => void;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: (cat: Category) => void;
  t: ReturnType<typeof import('@/hooks/use-theme').useTheme>;
}) {
  const isEditing = editingId === cat.id;
  const isDeleting = deletingId === cat.id;
  const isSaving = savingId === cat.id;
  const locked = isProtectedCategory(cat);

  return (
    <View style={[rowStyles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {isEditing ? (
        <View style={rowStyles.editRow}>
          <TextInput
            style={[rowStyles.editInput, { color: t.text, borderColor: t.accent }]}
            value={editDraft}
            onChangeText={onEditChange}
            returnKeyType="done"
            onSubmitEditing={onEditSave}
            autoFocus
            selectTextOnFocus
          />
          <View style={rowStyles.editActions}>
            <Pressable hitSlop={8} onPress={onEditSave} disabled={isSaving || !editDraft.trim()}>
              {isSaving
                ? <ActivityIndicator size="small" color={t.accent} />
                : <Feather name="check" size={18} color={t.accent} />}
            </Pressable>
            <Pressable hitSlop={8} onPress={onEditCancel}>
              <Feather name="x" size={18} color={t.muted} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={rowStyles.displayRow}>
          <Text style={[rowStyles.catName, { color: t.text }]} numberOfLines={1}>
            {cat.name}
          </Text>
          {locked ? (
            // "Others" is locked — balance edits file their difference here.
            <Feather name="lock" size={14} color={t.muted} />
          ) : (
            <View style={rowStyles.actions}>
              <Pressable hitSlop={8} onPress={() => onEditStart(cat)}>
                <Feather name="edit-2" size={15} color={t.muted} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => onDelete(cat)} disabled={isDeleting}>
                {isDeleting
                  ? <ActivityIndicator size="small" color={t.danger} />
                  : <Feather name="trash-2" size={15} color={t.danger} />}
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function ManageCategoriesScreen({ navigation }: any) {
  const t = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('expense');

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const [expName, setExpName] = useState('');
  const [expAdding, setExpAdding] = useState(false);
  const [incName, setIncName] = useState('');
  const [incAdding, setIncAdding] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (getCategories() as Promise<Category[]>).then((r) => {
      if (!cancelled) { setCategories(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []));

  async function handleAdd(kind: 'expense' | 'income') {
    const name = (kind === 'expense' ? expName : incName).trim();
    if (!name) return;
    if (kind === 'expense') setExpAdding(true); else setIncAdding(true);
    try {
      await addCategory(name, kind);
      if (kind === 'expense') setExpName(''); else setIncName('');
      setCategories(await getCategories() as Category[]);
    } finally {
      if (kind === 'expense') setExpAdding(false); else setIncAdding(false);
    }
  }

  function handleEditStart(cat: Category) {
    setEditingId(cat.id);
    setEditDraft(cat.name);
  }

  function handleEditCancel() {
    setEditingId(null);
    setEditDraft('');
  }

  async function handleEditSave() {
    if (!editingId || !editDraft.trim()) return;
    setSavingId(editingId);
    try {
      await (updateCategory as (id: string, ch: any) => Promise<void>)(editingId, { name: editDraft.trim() });
      setCategories((prev) => prev.map((c) => c.id === editingId ? { ...c, name: editDraft.trim() } : c));
      setEditingId(null);
      setEditDraft('');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save.');
    } finally {
      setSavingId(null);
    }
  }

  function confirmDelete(cat: Category) {
    Alert.alert(
      'Delete Category',
      `Delete "${cat.name}"? Any expenses tagged to it will be moved to Others.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeletingId(cat.id);
            try {
              await deleteCategory(cat.id);
              setCategories((prev) => prev.filter((c) => c.id !== cat.id));
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not delete.');
            } finally { setDeletingId(null); }
          },
        },
      ],
    );
  }

  const expCats = categories.filter((c) => !c.kind || c.kind === 'expense');
  const incCats = categories.filter((c) => c.kind === 'income');
  const visibleCats = activeTab === 'expense' ? expCats : incCats;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerSide}>
            <Feather name="chevron-left" size={22} color={t.muted} />
          </Pressable>
          <ThemedText type="stackTitle">Categories</ThemedText>
          <View style={styles.headerSide} />
        </View>

        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: t.border }]}>
          {(['expense', 'income'] as Tab[]).map((tab) => {
            const active = activeTab === tab;
            return (
              <Pressable
                key={tab}
                style={[styles.tab, active && { borderBottomColor: t.accent }]}
                onPress={() => { setActiveTab(tab); setEditingId(null); }}
              >
                <Text style={[styles.tabText, { color: active ? t.accent : t.muted }]}>
                  {tab === 'expense' ? 'Expenses' : 'Income'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
          ) : (
            <ScrollView
              contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
              keyboardShouldPersistTaps="handled"
            >
              {/* Add new at top */}
              <AddRow
                value={activeTab === 'expense' ? expName : incName}
                onChange={activeTab === 'expense' ? setExpName : setIncName}
                onAdd={() => handleAdd(activeTab === 'expense' ? 'expense' : 'income')}
                adding={activeTab === 'expense' ? expAdding : incAdding}
                t={t}
              />

              {/* Category list */}
              <View style={styles.list}>
                {visibleCats.map((cat) => (
                  <CategoryRow
                    key={cat.id}
                    cat={cat}
                    deletingId={deletingId}
                    editingId={editingId}
                    editDraft={editDraft}
                    savingId={savingId}
                    onEditStart={handleEditStart}
                    onEditChange={setEditDraft}
                    onEditSave={handleEditSave}
                    onEditCancel={handleEditCancel}
                    onDelete={confirmDelete}
                    t={t}
                  />
                ))}
                {visibleCats.length === 0 && (
                  <Text style={[styles.emptyText, { color: t.muted }]}>No categories yet.</Text>
                )}
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 14, fontWeight: '600' },
  content: { paddingTop: Spacing.three, paddingBottom: Spacing.four },
  list: { marginTop: Spacing.two, gap: Spacing.one + Spacing.half },
  emptyText: { textAlign: 'center', fontSize: 13, marginTop: Spacing.three },
});

const rowStyles = StyleSheet.create({
  card: {
    borderRadius: Radii.card, borderWidth: 1, paddingHorizontal: 16, overflow: 'hidden',
  },
  displayRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14,
  },
  catName: { fontSize: 14, flex: 1, marginRight: Spacing.two },
  actions: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
  },
  editInput: {
    flex: 1, fontSize: 14, borderWidth: 1, borderRadius: Radii.button,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  editActions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  addInput: {
    flex: 1, borderRadius: Radii.button, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 14, borderWidth: 1,
  },
  addBtn: {
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: Radii.button,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  addBtnText: { fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.4 },
});

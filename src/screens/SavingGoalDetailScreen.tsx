import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/hooks/use-theme';
import { Radii, ScreenPadding } from '@/constants/theme';
import { formatMoney } from '@/logic/moneyFormatter';
import { computeGoalConversion, type GoalConversion } from '@/logic/savingGoalConversion';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay, rawToAmount, amountToRaw } from '@/components/NumericKeypad';
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import { getExchangeRate, monthRateDate } from '@/api/exchangeRate';
import {
  completeSavingGoal, deleteGoalPhoto, deleteSavingGoal, getSavingGoals, getSettings,
  persistGoalPhoto, recordMonthlyRate, reopenSavingGoal, upsertSavingGoal,
} from '@/storage/storage';

const MAX_GOAL_PHOTOS = 3;

// helpers

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function nowMonthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_SHORT[parseInt(m, 10) - 1]} ${y}`;
}

function monthLabelFull(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_FULL[parseInt(m, 10) - 1]} ${y}`;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function monthRange(from: string, to: string): string[] {
  const result: string[] = [];
  let cur = from;
  while (cur <= to) {
    result.push(cur);
    cur = addMonths(cur, 1);
  }
  return result;
}


// Month picker modal

function MonthPickModal({
  visible, title, minMonth, onClose, onSelect,
}: {
  visible: boolean; title: string; minMonth?: string;
  onClose: () => void; onSelect: (ym: string) => void;
}) {
  const t = useTheme();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());

  function isDisabled(y: number, m: number): boolean {
    if (!minMonth) return false;
    return `${y}-${String(m).padStart(2, '0')}` < minMonth;
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={mp.scrim} onPress={onClose} />
      <View style={[mp.sheet, { backgroundColor: t.surface }]}>
        <View style={[mp.handle, { backgroundColor: t.track }]} />
        <Text style={[mp.title, { color: t.text }]}>{title}</Text>
        <View style={mp.yearRow}>
          <Pressable hitSlop={14} onPress={() => setYear((y) => y - 1)}>
            <Feather name="chevron-left" size={20} color={t.text} />
          </Pressable>
          <Text style={[mp.yearLabel, { color: t.text }]}>{year}</Text>
          <Pressable hitSlop={14} onPress={() => setYear((y) => y + 1)}>
            <Feather name="chevron-right" size={20} color={t.text} />
          </Pressable>
        </View>
        <View style={mp.grid}>
          {MONTH_SHORT.map((abbrev, idx) => {
            const m = idx + 1;
            const disabled = isDisabled(year, m);
            return (
              <Pressable
                key={m}
                disabled={disabled}
                style={[mp.chip, { backgroundColor: t.bg }, disabled && mp.chipDisabled]}
                onPress={() => {
                  onSelect(`${year}-${String(m).padStart(2, '0')}`);
                  onClose();
                }}
              >
                <Text style={[mp.chipText, { color: disabled ? t.muted : t.text }]}>
                  {abbrev}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const mp = StyleSheet.create({
  scrim:       { flex: 1, backgroundColor: 'rgba(10,26,25,0.45)' },
  sheet:       { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 22, paddingBottom: 36, paddingTop: 10 },
  handle:      { width: 38, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  title:       { fontSize: 16, fontWeight: '700', marginBottom: 16 },
  yearRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  yearLabel:   { fontSize: 16, fontWeight: '700' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { width: '23%', height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipDisabled:{ opacity: 0.3 },
  chipText:    { fontSize: 13, fontWeight: '500' },
});

// Main screen

export default function SavingGoalDetailScreen({ route, navigation }: any) {
  const { goalId } = (route.params ?? {}) as { goalId?: string };
  const t = useTheme();
  const isNew = !goalId;

  // Form state
  const [currency, setCurrency]           = useState('SGD');
  const [homeCurrency, setHomeCurrency]   = useState('SGD');
  const [name, setName]                   = useState('');
  const [startMonth, setStartMonth]       = useState(nowMonthPrefix());
  const [rawGoal, setRawGoal]             = useState('');
  const [finishByMonth, setFinishByMonth] = useState('');
  const [rawPerMonth, setRawPerMonth]     = useState('');
  const [rawAllocs, setRawAllocs]         = useState<Record<string, string>>({});
  const [completedAt, setCompletedAt]     = useState<string | null>(null);
  // "visual goal" photos (file:// uris). originalPhotos = what was on disk when
  // we opened this goal, used to clean up files that get removed on save.
  const [photos, setPhotos]               = useState<string[]>([]);
  const [originalPhotos, setOriginalPhotos] = useState<string[]>([]);

  // ui state
  // editingField: null = numpad closed, else which field is being edited
  const [editingField, setEditingField]         = useState<null | 'goal' | 'perMonth' | string>(null);
  const [showStartPicker, setShowStartPicker]   = useState(false);
  const [showFinishPicker, setShowFinishPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [rateToHome, setRateToHome]             = useState<number | null>(null);
  const [rateSheetOpen, setRateSheetOpen]       = useState(false);
  const [conv, setConv]                         = useState<GoalConversion | null>(null);
  // saved manual rates for this goal, by month
  const [monthlyRates, setMonthlyRates]         = useState<Record<string, number>>({});
  const [rateManual, setRateManual]             = useState(false);

  // load the goal
  useFocusEffect(useCallback(() => {
    (async () => {
      const settings = await getSettings() as any;
      const homeC = settings.homeCurrency ?? 'SGD';
      setHomeCurrency(homeC);
      if (!isNew && goalId) {
        const goals = await getSavingGoals() as any[];
        const g = goals.find((x: any) => x.id === goalId);
        if (!g) return;
        const goalCurrency = g.currency ?? homeC;
        setCurrency(goalCurrency);
        setName(g.name ?? '');
        setStartMonth(g.startMonth ?? nowMonthPrefix());
        setRawGoal(g.targetAmount > 0 ? amountToRaw(g.targetAmount, goalCurrency) : '');
        setFinishByMonth(g.finishByMonth ?? '');
        setRawPerMonth(g.perMonth > 0 && !g.finishByMonth ? amountToRaw(g.perMonth, goalCurrency) : '');
        setCompletedAt(g.completedAt ?? null);
        const allocs: Record<string, string> = {};
        for (const [m, amt] of Object.entries(g.monthlyAllocations ?? {})) {
          if ((amt as number) > 0) allocs[m] = amountToRaw(amt as number, goalCurrency);
        }
        setRawAllocs(allocs);
        setMonthlyRates(g.monthlyRates ?? {});
        setPhotos(g.photos ?? []);
        setOriginalPhotos(g.photos ?? []);
      } else {
        setCurrency(homeC);
        setMonthlyRates({});
        setPhotos([]);
        setOriginalPhotos([]);
      }
    })();
  }, [goalId]));

  // this month's rate: use the saved manual one, else fetch today's
  useEffect(() => {
    if (currency === homeCurrency) { setRateToHome(null); setRateManual(false); return; }
    const cur = nowMonthPrefix();
    const saved = monthlyRates[cur];
    if (saved != null) { setRateToHome(saved); setRateManual(true); return; }
    setRateManual(false);
    // ignore the fetch if it fails or a manual rate was set meanwhile
    let cancelled = false;
    getExchangeRate(currency, homeCurrency, monthRateDate(cur)).then((r) => {
      if (!cancelled && r != null) setRateToHome(r);
    });
    return () => { cancelled = true; };
  }, [currency, homeCurrency, monthlyRates]);

  // worked-out values
  const goalValue      = rawToAmount(rawGoal, currency);
  const perMonthValue  = rawToAmount(rawPerMonth, currency);
  const savedValue     = Object.values(rawAllocs).reduce((s, r) => s + rawToAmount(r, currency), 0);
  const remaining      = Math.max(0, goalValue - savedValue);
  const perMonthActive = perMonthValue > 0;
  const finishByActive = finishByMonth !== '';

  let computedPerMonth: number | null = null;
  if (finishByActive && goalValue > 0 && finishByMonth > startMonth) {
    const months = monthsBetween(startMonth, finishByMonth);
    if (months > 0) computedPerMonth = remaining / months;
  }

  let computedFinishBy: string | null = null;
  if (perMonthActive && !finishByActive && goalValue > 0 && perMonthValue > 0) {
    computedFinishBy = addMonths(startMonth, Math.ceil(remaining / perMonthValue));
  }

  const effectivePerMonth = computedPerMonth ?? perMonthValue;

  // convert the goal numbers to home currency
  useEffect(() => {
    let cancelled = false;
    const allocations: Record<string, number> = {};
    for (const [m, r] of Object.entries(rawAllocs)) {
      const v = rawToAmount(r, currency);
      if (v > 0) allocations[m] = v;
    }
    computeGoalConversion({
      currency, homeCurrency, allocations,
      target: goalValue, perMonth: effectivePerMonth,
      savedFallback: savedValue, completedAt,
    }).then((c) => { if (!cancelled) setConv(c); });
    return () => { cancelled = true; };
  }, [currency, homeCurrency, rawAllocs, goalValue, effectivePerMonth, savedValue, completedAt]);

  const isForeignGoal = currency !== homeCurrency;
  const goalPct = goalValue > 0 ? Math.min(1, savedValue / goalValue) : 0;
  // use the editable rate if set, else the fetched conversion
  const homeSaved = rateToHome != null ? savedValue * rateToHome : (conv?.savedHome ?? null);
  const homeTarget = rateToHome != null ? goalValue * rateToHome : (conv?.targetHome ?? null);
  const homeGoal = rateToHome != null ? goalValue * rateToHome : (conv?.targetHome ?? null);
  const homePerMonth = rateToHome != null ? effectivePerMonth * rateToHome : (conv?.perMonthHome ?? null);

  // history
  const current      = nowMonthPrefix();
  const historyMonths = startMonth ? monthRange(startMonth, current).reverse() : [];

  function getMonthStats(month: string) {
    const range       = monthRange(startMonth, month);
    const actualTotal = range.reduce((s, m) => s + rawToAmount(rawAllocs[m] ?? '', currency), 0);
    const expectedTotal = effectivePerMonth * range.length;
    return { actual: rawToAmount(rawAllocs[month] ?? '', currency), diff: actualTotal - expectedTotal };
  }

  // Numpad helpers
  function getCurrentRaw(): string {
    if (editingField === 'goal')    return rawGoal;
    if (editingField === 'perMonth') return rawPerMonth;
    if (editingField)               return rawAllocs[editingField] ?? '';
    return '';
  }

  function getEditingLabel(): string {
    if (editingField === 'goal')    return `Goal (${currency})`;
    if (editingField === 'perMonth') return `Per month (${currency})`;
    if (editingField)               return monthLabelFull(editingField);
    return '';
  }

  function handleNumKey(key: string) {
    if (editingField === 'goal') {
      setRawGoal((r) => applyNumpadKey(r, key, currency));
    } else if (editingField === 'perMonth') {
      setRawPerMonth((r) => applyNumpadKey(r, key, currency));
    } else if (editingField) {
      const month = editingField;
      setRawAllocs((r) => ({ ...r, [month]: applyNumpadKey(r[month] ?? '', key, currency) }));
    }
  }

  function openNumpad(field: 'goal' | 'perMonth' | string) {
    setShowStartPicker(false);
    setShowFinishPicker(false);
    setEditingField(field);
  }

  // Finish by picker
  function handlePickFinishBy(ym: string) {
    setFinishByMonth(ym);
    setRawPerMonth(''); // clear manual perMonth — finishBy now drives it
  }

  // Rate override (current month), shared with the allocation screen
  function applyManualRate(r: number) {
    const cur = nowMonthPrefix();
    setRateToHome(r);
    setRateManual(true);
    setMonthlyRates((prev) => ({ ...prev, [cur]: r }));
    if (goalId) recordMonthlyRate(goalId, cur, r);
  }

  function resetRateToAuto() {
    const cur = nowMonthPrefix();
    // removing the manual rate makes the auto rate load again
    setMonthlyRates((prev) => { const n = { ...prev }; delete n[cur]; return n; });
    if (goalId) recordMonthlyRate(goalId, cur, null);
  }

  // Photos ("visual goal")
  async function addPhotosFrom(source: 'camera' | 'library') {
    const remaining = MAX_GOAL_PHOTOS - photos.length;
    if (remaining <= 0) return;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera access needed', 'Turn on camera access for Tally in Settings to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: 'images', quality: 0.7, allowsEditing: true,
        });
        if (result.canceled || !result.assets?.length) return;
        await persistPicked(result.assets.slice(0, remaining).map((a) => a.uri));
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Photos access needed', 'Turn on photo access for Tally in Settings to choose a picture.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images', quality: 0.7,
          allowsMultipleSelection: true, selectionLimit: remaining,
        });
        if (result.canceled || !result.assets?.length) return;
        await persistPicked(result.assets.slice(0, remaining).map((a) => a.uri));
      }
    } catch {
      Alert.alert('Could not add photo', `Something went wrong opening the ${source === 'camera' ? 'camera' : 'library'}.`);
    }
  }

  async function persistPicked(uris: string[]) {
    const saved: string[] = [];
    for (const uri of uris) {
      // keep the temp uri if the copy fails, so the photo still shows
      try { saved.push(await persistGoalPhoto(uri)); }
      catch { saved.push(uri); }
    }
    setPhotos((prev) => [...prev, ...saved].slice(0, MAX_GOAL_PHOTOS));
  }

  function handleAddPhoto() {
    if (photos.length >= MAX_GOAL_PHOTOS) return;
    Alert.alert('Add a photo', "Picture what you're saving for.", [
      { text: 'Take photo', onPress: () => addPhotosFrom('camera') },
      { text: 'Choose from library', onPress: () => addPhotosFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleRemovePhoto(uri: string) {
    setPhotos((prev) => prev.filter((p) => p !== uri));
    // if it was added this session (not yet committed) the file is safe to bin now;
    // originals are cleaned up on save instead, so a back-out doesn't lose them
    if (!originalPhotos.includes(uri)) await deleteGoalPhoto(uri);
  }

  // Save
  async function handleSave() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    if (!startMonth)  { Alert.alert('Start month required'); return; }

    const monthlyAllocations: Record<string, number> = {};
    for (const [m, r] of Object.entries(rawAllocs)) {
      const v = rawToAmount(r, currency);
      if (v > 0) monthlyAllocations[m] = v;
    }

    await upsertSavingGoal({
      ...(goalId ? { id: goalId } : {}),
      name: name.trim(),
      targetAmount:  goalValue,
      savedAmount:   savedValue,
      currency,
      perMonth:      computedPerMonth ?? perMonthValue,
      startMonth,
      finishByMonth: finishByMonth || null,
      completedAt,
      monthlyAllocations,
      monthlyRates,
      photos,
    });
    // delete photo files that were removed from this goal
    for (const uri of originalPhotos.filter((u) => !photos.includes(u))) {
      await deleteGoalPhoto(uri);
    }
    navigation.goBack();
  }

  async function handleDelete() {
    if (!goalId) return;
    Alert.alert('Delete goal', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteSavingGoal(goalId); navigation.goBack(); },
      },
    ]);
  }

  async function handleComplete() {
    if (!goalId) return;
    await completeSavingGoal(goalId);
    setCompletedAt(new Date().toISOString());
  }

  async function handleReopen() {
    if (!goalId) return;
    await reopenSavingGoal(goalId);
    setCompletedAt(null);
  }

  // Render
  const numpadOpen = editingField !== null;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={['top']}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={20} color={t.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: t.text }]} numberOfLines={1}>
          {isNew ? 'New saving goal' : (name || 'Goal')}
        </Text>
        <Pressable hitSlop={12} onPress={handleSave}>
          <Text style={[s.saveAction, { color: t.accent }]}>{isNew ? 'Add' : 'Save'}</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.scroll, numpadOpen && { paddingBottom: 320 }]}
      >

        {/* ── Details card ── */}
        <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          {/* Name */}
          <View style={[s.row, { borderBottomColor: t.border }]}>
            <Text style={[s.rowLabel, { color: t.muted }]}>Goal name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onFocus={() => setEditingField(null)}
              placeholder="Tokyo trip, laptop…"
              placeholderTextColor={t.muted}
              style={[s.rowInput, { color: t.text }]}
            />
          </View>

          {/* Currency */}
          <Pressable
            style={[s.row, { borderBottomColor: t.border }]}
            onPress={() => { setEditingField(null); setShowCurrencyPicker(true); }}
          >
            <Text style={[s.rowLabel, { color: t.muted }]}>Currency</Text>
            <View style={s.rowRight}>
              <Text style={[s.rowValue, { color: t.text }]}>{currency}</Text>
              {currency !== homeCurrency && (
                <Text style={[s.foreignTag, { color: t.accent }]}>foreign</Text>
              )}
            </View>
          </Pressable>

          {/* Start month */}
          <Pressable
            style={[s.row, { borderBottomColor: t.border }]}
            onPress={() => { setEditingField(null); setShowStartPicker(true); }}
          >
            <Text style={[s.rowLabel, { color: t.muted }]}>
              Start month <Text style={{ color: t.danger }}>*</Text>
            </Text>
            <Text style={[s.rowValue, { color: t.text }]}>
              {startMonth ? monthLabel(startMonth) : 'Pick month'}
            </Text>
          </Pressable>

          {/* Goal amount — numpad tap */}
          <Pressable
            style={[s.row, { borderBottomColor: t.border }]}
            onPress={() => openNumpad('goal')}
          >
            <Text style={[s.rowLabel, { color: t.muted }]}>Goal ({currency})</Text>
            <View style={s.rowRight}>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[
                  s.rowValue,
                  { color: editingField === 'goal' ? t.accent : rawGoal ? t.text : t.muted },
                ]}>
                  {rawGoal ? `${currency} ${formatAmountDisplay(rawGoal, currency)}` : 'optional'}
                </Text>
                {isForeignGoal && rawGoal && homeGoal != null && (
                  <Text style={[s.conversionNote, { color: t.muted }]}>
                    ≈ {homeCurrency} {formatMoney(homeGoal, homeCurrency)}
                  </Text>
                )}
              </View>
              {rawGoal ? (
                <Pressable hitSlop={10} onPress={() => { setRawGoal(''); setEditingField(null); }}>
                  <Feather name="x" size={14} color={t.muted} />
                </Pressable>
              ) : null}
            </View>
          </Pressable>

          {/* Finish by — mutually exclusive with perMonth */}
          {perMonthActive ? (
            // Per month is set → finish by is auto-computed (locked)
            <View style={[s.row, { borderBottomColor: t.border }]}>
              <Text style={[s.rowLabel, { color: t.muted }]}>Finish by</Text>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, { color: t.muted }]}>
                  {computedFinishBy ? monthLabel(computedFinishBy) : '—'}
                </Text>
                <Feather name="lock" size={13} color={t.muted} />
              </View>
            </View>
          ) : (
            // finish by can be picked
            <Pressable
              style={[s.row, { borderBottomColor: t.border }]}
              onPress={() => { setEditingField(null); setShowFinishPicker(true); }}
            >
              <Text style={[s.rowLabel, { color: t.muted }]}>Finish by</Text>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, { color: finishByMonth ? t.text : t.muted }]}>
                  {finishByMonth ? monthLabel(finishByMonth) : 'optional'}
                </Text>
                {finishByMonth ? (
                  <Pressable hitSlop={10} onPress={() => setFinishByMonth('')}>
                    <Feather name="x" size={14} color={t.muted} />
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          )}

          {/* Per month — mutually exclusive with finishBy */}
          {finishByActive ? (
            // finish by is set, so per month is worked out (locked)
            <View style={[s.row, { borderBottomColor: 'transparent' }]}>
              <Text style={[s.rowLabel, { color: t.muted }]}>Per month ({currency})</Text>
              <View style={s.rowRight}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.rowValue, { color: t.muted }]}>
                    {computedPerMonth !== null ? `${currency} ${formatAmountDisplay(amountToRaw(computedPerMonth, currency), currency)}` : '—'}
                  </Text>
                  {isForeignGoal && computedPerMonth !== null && homePerMonth != null && (
                    <Text style={[s.conversionNote, { color: t.muted }]}>
                      ≈ {homeCurrency} {formatMoney(homePerMonth, homeCurrency)}
                    </Text>
                  )}
                </View>
                <Feather name="lock" size={13} color={t.muted} />
              </View>
            </View>
          ) : (
            // per month can be typed on the numpad
            <Pressable
              style={[s.row, { borderBottomColor: 'transparent' }]}
              onPress={() => openNumpad('perMonth')}
            >
              <Text style={[s.rowLabel, { color: t.muted }]}>Per month ({currency})</Text>
              <View style={s.rowRight}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[
                    s.rowValue,
                    { color: editingField === 'perMonth' ? t.accent : rawPerMonth ? t.text : t.muted },
                  ]}>
                    {rawPerMonth ? `${currency} ${formatAmountDisplay(rawPerMonth, currency)}` : 'optional'}
                  </Text>
                  {isForeignGoal && rawPerMonth && homePerMonth != null && (
                    <Text style={[s.conversionNote, { color: t.muted }]}>
                      ≈ {homeCurrency} {formatMoney(homePerMonth, homeCurrency)}
                    </Text>
                  )}
                </View>
                {rawPerMonth ? (
                  <Pressable hitSlop={10} onPress={() => { setRawPerMonth(''); setEditingField(null); }}>
                    <Feather name="x" size={14} color={t.muted} />
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          )}
        </View>

        {/* ── Visual goal (photos) ── */}
        <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[s.sectionEyebrow, { color: t.muted }]}>VISUAL GOAL</Text>
          <Text style={[s.photoHint, { color: t.muted }]}>
            Add up to 3 photos to picture what you're saving for.
          </Text>
          <View style={s.photoRow}>
            {photos.map((uri) => (
              <View key={uri} style={s.photoThumbWrap}>
                <Image source={{ uri }} style={s.photoThumb} contentFit="cover" />
                <Pressable
                  hitSlop={8}
                  style={s.photoRemove}
                  onPress={() => handleRemovePhoto(uri)}
                >
                  <Feather name="x" size={13} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_GOAL_PHOTOS && (
              <Pressable
                style={[s.photoAdd, { borderColor: t.border, backgroundColor: t.bg }]}
                onPress={handleAddPhoto}
              >
                <Feather name="plus" size={22} color={t.muted} />
                <Text style={[s.photoAddText, { color: t.muted }]}>Add</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Progress ── */}
        {goalValue > 0 && (
          <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border, gap: 6 }]}>
            <Text style={[s.sectionEyebrow, { color: t.muted }]}>PROGRESS</Text>
            <View style={[s.progressTrack, { backgroundColor: t.track }]}>
              <View style={[
                s.progressFill,
                {
                  backgroundColor: t.accent,
                  width: `${Math.round(goalPct * 100)}%` as any,
                },
              ]} />
            </View>
            <View style={s.progressRow}>
              <Text style={[s.progressSaved, { color: t.text }]}>
                {currency} {formatMoney(savedValue, currency)}
              </Text>
              <Text style={[s.progressTarget, { color: t.muted }]}>
                / {currency} {formatMoney(goalValue, currency)}
              </Text>
              <Text style={[s.progressPct, { color: t.accent }]}>
                ({Math.round(goalPct * 100)}%)
              </Text>
            </View>
            {isForeignGoal && homeSaved != null && homeTarget != null && (
              <Text style={[s.conversionNote, { color: t.muted, marginTop: -5, marginBottom: 6 }]}>
                {`≈ ${homeCurrency} ${formatMoney(homeSaved, homeCurrency)} / ${homeCurrency} ${formatMoney(homeTarget, homeCurrency)}`}
              </Text>
            )}
          </View>
        )}

        {/* ── Monthly history ── */}
        {historyMonths.length > 0 && (
          <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[s.sectionEyebrow, { color: t.muted }]}>MONTHLY HISTORY</Text>

            {/* Overview status banner — only when per month is set */}
            {effectivePerMonth > 0 && (() => {
              const { diff } = getMonthStats(current);
              const isBehind = diff < -0.005;
              const bgColor  = isBehind ? t.dangerSoft : t.accentSoft;
              const fgColor  = isBehind ? t.danger     : t.accentInk;
              return (
                <View style={[s.overviewBanner, { backgroundColor: bgColor }]}>
                  <Feather
                    name={isBehind ? 'alert-circle' : 'check-circle'}
                    size={16}
                    color={fgColor}
                  />
                  <Text style={[s.overviewText, { color: fgColor }]}>
                    {isBehind
                      ? `${currency} ${formatMoney(-diff, currency)} behind overall`
                      : 'On track'}
                  </Text>
                </View>
              );
            })()}

            {historyMonths.map((month, idx) => {
              const { actual, diff } = getMonthStats(month);
              const isThisMonth = month === current;
              const behind = effectivePerMonth > 0 && diff < -0.005;
              const onTrack = effectivePerMonth > 0 && diff >= -0.005;
              return (
                <View key={month}>
                  {idx > 0 && <View style={[s.divider, { backgroundColor: t.border }]} />}
                  <Pressable
                    style={[
                      s.historyRow,
                      editingField === month && { backgroundColor: t.accentSoft },
                    ]}
                    onPress={() => openNumpad(month)}
                  >
                    <View style={s.historyLeft}>
                      <Text style={[s.historyMonth, { color: t.text }]}>
                        {monthLabel(month)}
                        {isThisMonth && (
                          <Text style={[s.thisMonthTag, { color: t.accent }]}> · this month</Text>
                        )}
                      </Text>
                      {effectivePerMonth > 0 && (
                        <Text style={[
                          s.historyStatus,
                          { color: behind ? t.danger : onTrack && actual > 0 ? t.accentInk : t.muted },
                        ]}>
                          {behind
                            ? `${currency} ${formatMoney(-diff, currency)} behind`
                            : onTrack && actual > 0
                            ? 'on track'
                            : ''}
                        </Text>
                      )}
                    </View>
                    <View style={s.historyRight}>
                      <View style={s.historyAmountCol}>
                        <Text style={[s.historyAmount, { color: actual > 0 ? t.text : t.muted }]}>
                          {actual > 0 ? `${currency} ${formatMoney(actual, currency)}` : '—'}
                        </Text>
                        {isForeignGoal && actual > 0 && (
                          <Text style={[s.conversionNote, { color: t.muted, textAlign: 'right' }]}>
                            {`≈ ${homeCurrency} ${formatMoney(actual * (monthlyRates[month] ?? rateToHome ?? conv?.goalRate ?? 1), homeCurrency)}`}
                          </Text>
                        )}
                      </View>
                      <Feather name="edit-2" size={13} color={t.muted} />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Status / actions ── */}
        {!isNew && (
          <View style={{ gap: 12 }}>
            {completedAt ? (
              <View style={[s.completedBanner, { backgroundColor: t.accentSoft, borderColor: t.accent }]}>
                <Feather name="check-circle" size={16} color={t.accentInk} />
                <Text style={[s.completedText, { color: t.accentInk }]}>Goal completed</Text>
                <Pressable hitSlop={10} onPress={handleReopen}>
                  <Text style={[s.reopenText, { color: t.accent }]}>Reopen</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={[s.actionBtn, { backgroundColor: t.accentSoft }]}
                onPress={handleComplete}
              >
                <Feather name="check-circle" size={16} color={t.accentInk} />
                <Text style={[s.actionBtnText, { color: t.accentInk }]}>Mark as complete</Text>
              </Pressable>
            )}
            <Pressable
              style={[s.actionBtn, { backgroundColor: t.dangerSoft }]}
              onPress={handleDelete}
            >
              <Feather name="trash-2" size={16} color={t.danger} />
              <Text style={[s.actionBtnText, { color: t.danger }]}>Delete goal</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Numpad drawer ── */}
      {numpadOpen && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingField(null)} />
          <View style={[s.numpadDrawer, { backgroundColor: t.surface, borderTopColor: t.border }]}>
            <View style={s.numpadHeader}>
              <Text style={[s.numpadLabel, { color: t.muted }]}>{getEditingLabel()}</Text>
              <Text style={[s.numpadValue, { color: t.text }]}>
                {currency} {formatAmountDisplay(getCurrentRaw(), currency)}
              </Text>
              <Pressable
                hitSlop={12}
                style={[s.doneBtn, { backgroundColor: t.accent }]}
                onPress={() => setEditingField(null)}
              >
                <Text style={[s.doneBtnText, { color: t.onAccent }]}>Done</Text>
              </Pressable>
            </View>

            {/* Exchange-rate footer — shown for non-home goals, like the expense input */}
            {currency !== homeCurrency && (() => {
              const amt = rawToAmount(getCurrentRaw(), currency);
              return (
                <Pressable
                  style={[s.rateRow, { borderColor: t.border, backgroundColor: t.bg }]}
                  onPress={() => setRateSheetOpen(true)}
                >
                  <Feather name="refresh-cw" size={13} color={t.muted} />
                  <View style={s.rateRowLines}>
                    <Text style={[s.rateRowLabel, { color: t.muted }]}>
                      {'1 '}{currency}{' = '}
                      <Text style={[s.rateRowValue, { color: t.text }]}>{rateToHome ?? '…'}</Text>
                      {' '}{homeCurrency}
                    </Text>
                    <Text style={[s.rateRowLabel, { color: t.muted }]}>
                      {formatMoney(amt, currency)}{' '}{currency}{' = '}
                      <Text style={[s.rateRowValue, { color: t.text }]}>
                        {rateToHome !== null ? formatMoney(amt * rateToHome, homeCurrency) : '…'}
                      </Text>
                      {' '}{homeCurrency}
                    </Text>
                  </View>
                  {rateManual ? (
                    <Pressable
                      hitSlop={8}
                      style={[s.autoBtn, { borderColor: t.accent }]}
                      onPress={resetRateToAuto}
                    >
                      <Feather name="refresh-cw" size={11} color={t.accent} />
                      <Text style={[s.autoBtnText, { color: t.accent }]}>auto</Text>
                    </Pressable>
                  ) : (
                    <Text style={[s.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
                  )}
                </Pressable>
              );
            })()}

            <NumericKeypad onKey={handleNumKey} />
          </View>

          {/* Rate adjust sheet — edit the goal→home rate, like the expense input */}
          {rateSheetOpen && currency !== homeCurrency && (
            <GoalRateSheet
              fromCurrency={currency}
              toCurrency={homeCurrency}
              rate={rateToHome}
              amount={rawToAmount(getCurrentRaw(), currency)}
              t={t}
              onSave={(unitRate) => applyManualRate(unitRate)}
              onClose={() => setRateSheetOpen(false)}
            />
          )}
        </>
      )}

      {/* ── Currency picker ── */}
      <CurrencyPickerModal
        visible={showCurrencyPicker}
        selected={currency}
        onSelect={(code) => { setCurrency(code); setShowCurrencyPicker(false); }}
        onClose={() => setShowCurrencyPicker(false)}
      />

      {/* ── Month pickers ── */}
      <MonthPickModal
        visible={showStartPicker}
        title="Start month"
        onClose={() => setShowStartPicker(false)}
        onSelect={(ym) => setStartMonth(ym)}
      />
      <MonthPickModal
        visible={showFinishPicker}
        title="Finish by"
        minMonth={startMonth ? addMonths(startMonth, 1) : undefined}
        onClose={() => setShowFinishPicker(false)}
        onSelect={handlePickFinishBy}
      />
    </SafeAreaView>
  );
}

// GoalRateSheet
// Mirrors the expense entry's rate editor: tap either row to set the unit
// rate (1 from = N to) or the converted total; both stay in sync.

function applyRateKey(raw: string, key: string): string {
  if (key === 'backspace') return raw.slice(0, -1);
  if (key === '.') {
    if (raw.includes('.')) return raw;
    return (raw || '0') + '.';
  }
  if (raw.length >= 10) return raw;
  const dotIdx = raw.indexOf('.');
  if (dotIdx !== -1 && raw.length - dotIdx > 6) return raw;
  if (raw === '0') return key;
  return raw + key;
}

function GoalRateSheet({ onClose, fromCurrency, toCurrency, rate, amount, onSave, t }: {
  onClose: () => void;
  fromCurrency: string; toCurrency: string;
  rate: number | null; amount: number; onSave: (r: number) => void; t: any;
}) {
  const [draft, setDraft] = useState(rate !== null ? String(rate) : '');
  const [activeField, setActiveField] = useState<'unit' | 'total'>('unit');

  function switchTo(field: 'unit' | 'total') {
    if (field === activeField) return;
    const n = parseFloat(draft) || 0;
    if (field === 'total') {
      const total = amount > 0 ? Math.round(n * amount * 100) / 100 : 0;
      setDraft(total > 0 ? String(total) : '');
    } else {
      const unitRate = amount > 0 ? Math.round((n / amount) * 1e6) / 1e6 : 0;
      setDraft(unitRate > 0 ? String(unitRate) : '');
    }
    setActiveField(field);
  }

  function handleApply() {
    const n = parseFloat(draft);
    const resolvedRate = activeField === 'unit' ? n : (amount > 0 ? n / amount : 0);
    if (isNaN(resolvedRate) || resolvedRate <= 0) { onClose(); return; }
    onSave(Math.round(resolvedRate * 1e6) / 1e6);
    onClose();
  }

  const draftNum = parseFloat(draft) || 0;
  const computedUnit = activeField === 'total' && amount > 0
    ? Math.round((draftNum / amount) * 1e6) / 1e6 : null;
  const computedTotal = activeField === 'unit' && amount > 0
    ? Math.round(draftNum * amount * 100) / 100 : null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.rateSheetScrim} onPress={onClose} />
      <View style={[s.rateSheet, { backgroundColor: t.surface }]}>
        <View style={s.rateSheetHead}>
          <Text style={[s.rateSheetTitle, { color: t.text }]}>Adjust Rate</Text>
          <Pressable hitSlop={16} onPress={handleApply}>
            <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>

        {/* Unit rate row */}
        <Pressable
          style={[s.rateEditRow, { borderColor: activeField === 'unit' ? t.accent : t.border, backgroundColor: t.bg }]}
          onPress={() => switchTo('unit')}
        >
          <Text style={[s.rateRowLabel, { color: t.muted }]}>1 {fromCurrency} =</Text>
          <Text style={[s.rateEditValue, { color: activeField === 'unit' ? (draft ? t.text : t.muted) : t.muted }]}>
            {activeField === 'unit'
              ? (draft || '0.00')
              : (computedUnit != null && computedUnit > 0 ? String(computedUnit) : '—')}
          </Text>
          <Text style={[s.rateRowLabel, { color: t.muted }]}>{toCurrency}</Text>
        </Pressable>

        {/* Converted total row */}
        {amount > 0 && (
          <Pressable
            style={[s.rateEditRow, { borderColor: activeField === 'total' ? t.accent : t.border, backgroundColor: t.bg }]}
            onPress={() => switchTo('total')}
          >
            <Text style={[s.rateRowLabel, { color: t.muted }]}>
              {formatMoney(amount, fromCurrency)} {fromCurrency} =
            </Text>
            <Text style={[s.rateEditValue, { color: activeField === 'total' ? (draft ? t.text : t.muted) : t.muted }]}>
              {activeField === 'total'
                ? (draft || '0.00')
                : (computedTotal != null && computedTotal > 0 ? formatMoney(computedTotal, toCurrency) : '—')}
            </Text>
            <Text style={[s.rateRowLabel, { color: t.muted }]}>{toCurrency}</Text>
          </Pressable>
        )}

        <NumericKeypad bottomLeftKey="." onKey={(key) => setDraft((d) => applyRateKey(d, key))} />
        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: ScreenPadding, paddingTop: 12, paddingBottom: 10 }}>
          <Pressable style={[s.rateApplyBtn, { backgroundColor: t.accent }]} onPress={handleApply}>
            <Text style={[s.rateApplyBtnText, { color: t.onAccent }]}>Apply Rate</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// styles

const s = StyleSheet.create({
  root:        { flex: 1 },
  header:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  saveAction:  { fontSize: 16, fontWeight: '600' },
  scroll:      { paddingHorizontal: ScreenPadding, gap: 16, paddingBottom: 40 },

  card: { borderRadius: Radii.card, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 6, overflow: 'hidden' },

  sectionEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingTop: 12, paddingBottom: 4 },

  photoHint:      { fontSize: 12, lineHeight: 17, paddingBottom: 12 },
  photoRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 16 },
  photoThumbWrap: { width: 84, height: 84 },
  photoThumb:     { width: 84, height: 84, borderRadius: 12 },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)',
  },
  photoAdd: {
    width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  photoAddText:   { fontSize: 12, fontWeight: '500' },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  rowLabel:  { fontSize: 13, flex: 1 },
  rowInput:  { flex: 1.4, textAlign: 'right', fontSize: 15, fontWeight: '500' },
  rowValue:  { fontSize: 15, fontWeight: '500' },
  rowRight:  { flexDirection: 'row', alignItems: 'center', gap: 8 },

  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { height: 7, borderRadius: 4 },
  progressRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingBottom: 6 },
  progressSaved: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  progressPct:   { fontSize: 13, fontWeight: '700' },
  progressTarget:{ fontSize: 13 },

  divider: { height: StyleSheet.hairlineWidth },

  overviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 4,
  },
  overviewText: { fontSize: 14, fontWeight: '700' },

  historyRow:   {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 2, gap: 12, borderRadius: 8,
  },
  historyLeft:   { flex: 1, gap: 2 },
  historyMonth:  { fontSize: 14, fontWeight: '600' },
  thisMonthTag:  { fontSize: 13, fontWeight: '500' },
  historyStatus: { fontSize: 12 },
  historyRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyAmountCol: { alignItems: 'flex-end', gap: 2 },
  historyAmount:    { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  conversionNote:   { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  foreignTag:       { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: Radii.card,
  },
  actionBtnText: { fontSize: 15, fontWeight: '600' },

  completedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 18, borderRadius: Radii.card, borderWidth: 1,
  },
  completedText: { flex: 1, fontSize: 15, fontWeight: '600' },
  reopenText:    { fontSize: 14, fontWeight: '600' },

  numpadDrawer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  numpadHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: 12, gap: 12,
  },
  numpadLabel:   { fontSize: 12, flex: 1 },
  numpadValue:   { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  doneBtn:       { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12 },
  doneBtnText:   { fontSize: 14, fontWeight: '700' },

  // Rate footer inside the numpad drawer
  rateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: ScreenPadding, marginBottom: 12,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
  },
  rateRowLines:  { flex: 1, gap: 2 },
  rateRowLabel:  { fontSize: 12 },
  rateRowValue:  { fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  rateRowAdjust: { fontSize: 12, fontWeight: '600' },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  autoBtnText: { fontSize: 12, fontWeight: '700' },

  // Rate adjust sheet
  rateSheetScrim: { flex: 1, backgroundColor: 'transparent' },
  rateSheet:      { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 16, gap: 10 },
  rateSheetHead:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingBottom: 4,
  },
  rateSheetTitle: { fontSize: 16, fontWeight: '700' },
  rateEditRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginHorizontal: ScreenPadding,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14,
  },
  rateEditValue:  { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] as any },
  rateApplyBtn:     { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rateApplyBtnText: { fontSize: 14, fontWeight: '600' },
});

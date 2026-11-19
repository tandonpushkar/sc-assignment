import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet as S,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons as Icons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import Storage from "expo-sqlite/kv-store";
import packet from "./fixtures/packet.json";
import { buckets, ContractMath, FlagList, FlagSummary } from "./ReviewFlags";
import {
  reviewQueue,
  review,
  resolve,
  attach,
  flagged,
  schemas,
} from "./review";
import { pickDocument } from "./importFile";

const ink = "#FAFAFA",
  muted = "#B8B8B8",
  gold = "#E3B02F",
  paper = "#101010",
  ochre = "#FFCB75";
const icons = {
  "Change order": "file-sign",
  Invoice: "file-document-outline",
  "Purchase order": "clipboard-list-outline",
  Receipt: "receipt",
};
const key = "fielddesk.records.v1";
function Icon({ name, size = 22, color = ink }) {
  return <Icons name={name} size={size} color={color} />;
}
function Heading({ children, small }) {
  return (
    <Text
      accessibilityRole="header"
      style={[s.display, { fontSize: small ? 22 : 37 }]}
    >
      {children}
    </Text>
  );
}
function Action({ children, icon, onPress, light = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        light && s.secondary,
        { opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Icon name={icon} size={18} color={light ? ink : "#111"} />
      <Text style={{ fontWeight: "700", color: light ? ink : "#111" }}>
        {children}
      </Text>
    </Pressable>
  );
}
function Chip({ children, active, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: ink, borderColor: ink }]}
    >
      <Text style={{ fontWeight: "600", color: active ? "#111" : muted }}>
        {children}
      </Text>
    </Pressable>
  );
}
function Tag({ value, open }) {
  return (
    <Text
      style={[
        s.tag,
        {
          color: open ? ochre : "#94DEAA",
          backgroundColor: open ? "#3F300F" : "#253226",
        },
      ]}
    >
      {value}
    </Text>
  );
}
const newId = () =>
  String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
function Desk() {
  const [records, setRecords] = useState(null),
    [selected, select] = useState(null),
    [filter, setFilter] = useState("All");
  const [bucket, setBucket] = useState(null);
  const [sheet, setSheet] = useState(null),
    [draft, setDraft] = useState(""),
    [kind, setKind] = useState("Invoice"),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(null);
  useEffect(() => {
    try {
      const saved = Storage.getItemSync(key);
      const existing = saved ? JSON.parse(saved) : packet;
      const additions = packet.filter(
        (sample) => !existing.some((record) => record.id === sample.id),
      );
      setRecords([...existing, ...additions]);
    } catch {
      Alert.alert("Storage unavailable", "The sample packet is open.");
      setRecords(packet);
    }
  }, []);
  const back = () => {
    if (sheet) {
      if (!busy) setSheet(null);
      return true;
    }
    if (source) {
      setSource(null);
      return true;
    }
    if (selected) {
      select(null);
      return true;
    }
    if (bucket) {
      setBucket(null);
      return true;
    }
    return false;
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [sheet, selected, source, busy, bucket]);
  const queue = useMemo(() => reviewQueue(records || []), [records]);
  if (!records) return <ActivityIndicator />;
  const record = records.find((r) => r.id === selected);
  const rows = records.map((r) => ({
    record: r,
    open: queue.filter(
      (entry) => entry.recordId === r.id && flagged(entry.field),
    ).length,
  }));
  const files = records.reduce((n, r) => n + r.docs.length, 0),
    open = rows.reduce((n, r) => n + r.open, 0);
  function save(next) {
    Storage.setItemSync(key, JSON.stringify(next));
    setRecords(next);
  }
  function showImport(mode) {
    setKind(record?.kind || "Invoice");
    setDraft("");
    setSheet({ mode });
  }
  async function doImport(paste) {
    if (busy) return;
    setBusy(true);
    try {
      if (paste && !draft.trim())
        throw Error("Paste document text before continuing.");
      const doc = paste
        ? {
            name:
              "Pasted " +
              kind.toLowerCase() +
              " " +
              (record?.docs.length + 1 || 1),
            pages: [{ text: draft.trim(), method: "Text" }],
          }
        : await pickDocument();
      if (!doc) return;
      const base =
        sheet.mode === "attach"
          ? record
          : { id: newId(), kind, title: doc.name, docs: [], decisions: {} };
      const next = attach(base, doc);
      save(
        sheet.mode === "attach"
          ? records.map((r) => (r.id === base.id ? next : r))
          : [next, ...records],
      );
      setSheet(null);
      select(next.id);
    } catch (e) {
      Alert.alert("Import requires attention", e.message);
    } finally {
      setBusy(false);
    }
  }
  function confirm() {
    try {
      const next = resolve(record, sheet.field.label, draft);
      save(records.map((r) => (r.id === next.id ? next : r)));
      setSheet(null);
    } catch (e) {
      Alert.alert("Check value", e.message);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={paper} />
      <ScrollView
        key={source?.name || selected || bucket || "desk"}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.brand}>
          <View style={[s.logo, { backgroundColor: gold }]}>
            <Icon name="layers-triple-outline" color="#111111" size={23} />
          </View>
          <Text style={s.wordmark}>Sledge Review</Text>
          <View style={s.spacer} />
          <Icon name="database-check-outline" size={16} color={muted} />
          <Text style={s.micro}>ON DEVICE</Text>
        </View>
        {record ? (
          <>
            <Pressable accessibilityRole="button" onPress={back} style={s.back}>
              <Icon name="arrow-left" size={18} />
              <Text style={s.caption}>
                {source
                  ? "Record details"
                  : bucket
                    ? "Review flags"
                    : "Review desk"}
              </Text>
            </Pressable>
            <Heading>{source ? source.name : record.title}</Heading>
            {source ? (
              source.pages.map((page, i) => (
                <View style={s.card} key={i}>
                  <Text style={s.kicker}>
                    PAGE {i + 1} · {page.method.toUpperCase()}
                  </Text>
                  <Text selectable style={s.transcript}>
                    {page.text}
                  </Text>
                </View>
              ))
            ) : (
              <>
                <Text style={s.caption}>
                  {record.kind} · {record.docs.length} source{" "}
                  {record.docs.length === 1 ? "file" : "files"}
                </Text>
                <Heading small>Field review</Heading>
                {review(record)
                  .sort((a, b) => Number(flagged(b)) - Number(flagged(a)))
                  .map((f) => (
                    <Pressable
                      accessibilityRole="button"
                      key={f.label}
                      style={s.card}
                      onPress={() => {
                        setDraft(f.value);
                        setSheet({ mode: "resolve", field: f });
                      }}
                    >
                      <View style={s.line}>
                        <Text style={s.label}>{f.label}</Text>
                        <Tag
                          value={
                            f.status === "Reviewed" && f.issue
                              ? "Reviewed · " + f.issue
                              : f.status
                          }
                          open={flagged(f)}
                        />
                      </View>
                      <Text style={s.result}>
                        {f.value ||
                          {
                            Missing: "Value required",
                            Conflict: "Sources disagree",
                            "Check format": "Check the source text",
                            "Amount mismatch":
                              "Printed amount differs from calculated total",
                          }[f.status]}
                      </Text>
                      <ContractMath field={f} />
                      {f.evidence.map((e, i) => (
                        <Text key={i} style={s.caption}>
                          {e.raw} · {e.file} · p{e.page}, line {e.line}
                        </Text>
                      ))}
                    </Pressable>
                  ))}
                <Heading small>Source documents</Heading>
                {record.docs.map((d, i) => (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    style={[s.card, s.line]}
                    onPress={() => setSource(d)}
                  >
                    <Icon name="file-search-outline" />
                    <Text style={[s.label, s.flex]}>{d.name}</Text>
                    <Icon name="chevron-right" />
                  </Pressable>
                ))}
                <Action
                  light
                  icon="link-plus"
                  onPress={() => showImport("attach")}
                >
                  Attach another copy
                </Action>
              </>
            )}
          </>
        ) : bucket ? (
          <>
            <Pressable
              accessibilityRole="button"
              style={s.back}
              onPress={() => setBucket(null)}
            >
              <Icon name="arrow-left" size={18} />
              <Text style={s.caption}>Review desk</Text>
            </Pressable>
            <Heading>Review flags</Heading>
            <View style={s.filters}>
              {buckets.map((b) => (
                <Chip
                  key={b.key}
                  active={bucket === b.key}
                  onPress={() => setBucket(b.key)}
                >
                  {b.name}
                </Chip>
              ))}
            </View>
            <FlagList
              rows={queue}
              bucket={bucket}
              onOpen={(id, f) => {
                select(id);
                setDraft(f.value);
                setSheet({ mode: "resolve", field: f });
              }}
            />
          </>
        ) : (
          <>
            <View>
              <Text style={s.kicker}>WEST YARD / DOCUMENT CONTROL</Text>
              <Heading>Review desk</Heading>
            </View>
            <Text style={s.caption}>
              {files} source files · {records.length} records · {open} open
              flags
            </Text>
            <FlagSummary rows={queue} onSelect={setBucket} />
            <View style={s.line}>
              <Heading small>Document register</Heading>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Import document"
                style={s.add}
                onPress={() => showImport("new")}
              >
                <Icon name="plus" color="#111" size={17} />
                <Text style={s.addText}>Import</Text>
              </Pressable>
            </View>
            <View style={s.filters}>
              {["All", "Needs review", "Ready"].map((v) => (
                <Chip
                  key={v}
                  active={filter === v}
                  onPress={() => setFilter(v)}
                >
                  {v}
                </Chip>
              ))}
            </View>
            {rows
              .filter(
                (r) =>
                  filter === "All" ||
                  (filter === "Ready" ? r.open === 0 : r.open > 0),
              )
              .map(({ record: r, open: n }) => (
                <Pressable
                  accessibilityRole="button"
                  key={r.id}
                  style={s.doc}
                  onPress={() => select(r.id)}
                >
                  <View style={s.line}>
                    <View style={s.iconBox}>
                      <Icon name={icons[r.kind]} />
                    </View>
                    <Tag value={n ? n + " open" : "Ready"} open={n > 0} />
                  </View>
                  <Text style={s.docTitle}>{r.title}</Text>
                  <View style={s.line}>
                    <Text style={s.caption}>
                      {r.kind} · {r.docs.length}{" "}
                      {r.docs.length === 1 ? "source" : "sources"}
                    </Text>
                    <Icon name="arrow-top-right" size={17} />
                  </View>
                </Pressable>
              ))}
            {!rows.some(
              (r) =>
                filter === "All" ||
                (filter === "Ready" ? r.open === 0 : r.open > 0),
            ) && <Text style={s.caption}>No records in this view.</Text>}
          </>
        )}
      </ScrollView>
      <Modal
        visible={!!sheet}
        transparent
        animationType="slide"
        onRequestClose={back}
      >
        <View style={s.scrim}>
          <SafeAreaView style={s.sheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.sheetBody}
            >
              <View style={s.line}>
                <Heading small>
                  {sheet?.mode === "resolve"
                    ? sheet.field.label
                    : sheet?.mode === "attach"
                      ? "Attach a source"
                      : "Import document"}
                </Heading>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => setSheet(null)}
                >
                  <Icon name="close" />
                </Pressable>
              </View>
              {sheet?.mode === "resolve" ? (
                <>
                  <Text style={s.caption}>
                    Select a source value or enter a correction.
                    {sheet.field.label === "Date" ? " Use YYYY-MM-DD." : ""}
                  </Text>
                  <ContractMath field={sheet.field} />
                  {sheet.field.evidence.map((e, i) => (
                    <Pressable
                      style={s.option}
                      key={i}
                      onPress={() => setDraft(e.raw)}
                    >
                      <Text style={s.label}>{e.raw}</Text>
                      <Text style={s.caption}>
                        {e.file} · page {e.page}, line {e.line}
                      </Text>
                    </Pressable>
                  ))}
                  <TextInput
                    accessibilityLabel="Reviewed value"
                    style={s.input}
                    value={draft}
                    placeholderTextColor={muted}
                    placeholder="Reviewed value"
                    onChangeText={setDraft}
                  />
                  <Action icon="check" onPress={confirm}>
                    Save reviewed value
                  </Action>
                </>
              ) : busy ? (
                <ActivityIndicator size="large" color={gold} />
              ) : (
                <>
                  {sheet?.mode === "new" ? (
                    <View style={s.filters}>
                      {Object.keys(schemas).map((k) => (
                        <Chip
                          key={k}
                          active={kind === k}
                          onPress={() => setKind(k)}
                        >
                          {k}
                        </Chip>
                      ))}
                    </View>
                  ) : (
                    <Text style={s.caption}>
                      Choose another copy of this same {kind.toLowerCase()}.
                      Adding evidence reopens prior decisions.
                    </Text>
                  )}
                  <Action
                    icon="folder-open-outline"
                    onPress={() => doImport(false)}
                  >
                    Choose PDF, image or text file
                  </Action>
                  <Text style={s.label}>Or paste document text</Text>
                  <TextInput
                    accessibilityLabel="Document text"
                    style={[
                      s.input,
                      { minHeight: 92, textAlignVertical: "top" },
                    ]}
                    multiline
                    placeholderTextColor={muted}
                    placeholder="Vendor: North Quarry Supply"
                    value={draft}
                    onChangeText={setDraft}
                  />
                  <Action
                    light
                    icon="text-box-check-outline"
                    onPress={() => doImport(true)}
                  >
                    Extract pasted text
                  </Action>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
export default function App() {
  const [loaded, error] = useFonts({
    WorkBold: require("./assets/fonts/WorkSans-Bold.ttf"),
  });
  return (
    <SafeAreaProvider>
      {loaded || error ? <Desk /> : <ActivityIndicator />}
    </SafeAreaProvider>
  );
}
const s = S.create({
  safe: { flex: 1, backgroundColor: paper },
  body: {
    padding: 20,
    paddingBottom: 44,
    gap: 14,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderColor: "#383838",
    paddingBottom: 14,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: ink,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontSize: 23,
    fontWeight: "800",
    letterSpacing: -1.2,
    color: ink,
  },
  spacer: { flex: 1 },
  flex: { flex: 1 },
  micro: { fontSize: 10, fontWeight: "700", color: muted, letterSpacing: 1 },
  display: { fontFamily: "WorkBold", letterSpacing: -1.3, color: ink },
  kicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.6, color: gold },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#525252",
  },
  doc: {
    backgroundColor: "#191919",
    borderWidth: 1,
    borderColor: "#353535",
    borderRadius: 13,
    padding: 15,
    gap: 6,
  },
  iconBox: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#303030",
  },
  docTitle: { fontSize: 19, fontWeight: "700", color: ink },
  caption: { fontSize: 13, lineHeight: 19, color: muted },
  tag: {
    fontSize: 12,
    fontWeight: "700",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 8,
    overflow: "hidden",
  },
  add: {
    backgroundColor: gold,
    borderRadius: 9,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  addText: { color: "#111", fontWeight: "700" },
  back: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingVertical: 4,
  },
  card: {
    backgroundColor: "#191919",
    borderWidth: 1,
    borderColor: "#353535",
    padding: 14,
    borderRadius: 12,
    gap: 5,
  },
  label: { fontWeight: "700", color: ink, fontSize: 15 },
  result: { fontSize: 18, color: ink, fontWeight: "600" },
  transcript: { fontSize: 15, lineHeight: 24, color: ink },
  action: {
    backgroundColor: gold,
    borderRadius: 10,
    padding: 14,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: "#333333" },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
  },
  sheetBody: { padding: 20, gap: 14 },
  input: {
    borderColor: "#555555",
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
    color: ink,
    backgroundColor: "#171717",
  },
  option: { padding: 12, borderRadius: 9, backgroundColor: "#272727" },
});

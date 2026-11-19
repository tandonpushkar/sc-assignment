import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Icons from "@expo/vector-icons/MaterialCommunityIcons";

export const buckets = [
  { key: "Conflict", name: "Conflicts", icon: "call-split", color: "#F5BA55" },
  {
    key: "Missing",
    name: "Missing",
    icon: "file-question-outline",
    color: "#F19485",
  },
  {
    key: "Check format",
    name: "Format",
    icon: "text-search",
    color: "#A2BFFF",
  },
  {
    key: "Amount mismatch",
    name: "Amount mismatch",
    icon: "calculator-variant-outline",
    color: "#FFBD77",
  },
  {
    key: "Reviewed",
    name: "Reviewed",
    icon: "check-circle-outline",
    color: "#80D5A7",
  },
];
export function bucketRows(rows, key) {
  return rows.filter(({ field }) => field.status === key);
}
export function FlagSummary({ rows, onSelect }) {
  return (
    <View style={s.panel}>
      <View style={s.heading}>
        <Text style={s.title}>Review flags</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect("Reviewed")}
          hitSlop={8}
        >
          <Text style={s.link}>Reviewed ›</Text>
        </Pressable>
      </View>
      <View style={s.tiles}>
        {buckets
          .filter((b) => b.key !== "Reviewed")
          .map((b) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                b.name + ", " + bucketRows(rows, b.key).length + " open"
              }
              style={s.tile}
              key={b.key}
              onPress={() => onSelect(b.key)}
            >
              <Icons name={b.icon} color={b.color} size={18} />
              <Text style={s.num}>{bucketRows(rows, b.key).length}</Text>
              <Text style={s.tileLabel}>{b.name}</Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}
function dollars(value) {
  const [units, cents] = value.replace("-", "").split(".");
  return (
    (value.startsWith("-") ? "−" : "") +
    "$" +
    units.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    cents
  );
}
export function ContractMath({ field }) {
  return (
    field.checks?.map((check, i) => (
      <View style={s.evidence} key={i}>
        {check.inputs.map((e) => (
          <View key={e.label}>
            <Text style={s.tileLabel}>
              {e.label} · {dollars(e.value)}
            </Text>
            <Text style={s.file}>
              {e.file} · p{e.page}, line {e.line}
            </Text>
          </View>
        ))}
        <Text style={s.link}>Expected revised contract</Text>
        <Text style={s.amount}>
          {dollars(check.inputs[0].value)}{" "}
          {check.inputs[1].value.startsWith("-") ? "−" : "+"}{" "}
          {dollars(check.inputs[1].value.replace("-", ""))} ={" "}
          {dollars(check.expected)}
        </Text>
      </View>
    )) || null
  );
}
export function FlagList({ rows, bucket, onOpen }) {
  const entries = bucketRows(rows, bucket);
  if (!entries.length)
    return (
      <Text style={s.empty}>
        {bucket === "Reviewed"
          ? "No reviewed flags yet."
          : "No open flags in this category."}
      </Text>
    );
  return entries.map(({ recordId, title, field }) => (
    <Pressable
      accessibilityRole="button"
      key={recordId + field.label}
      style={s.item}
      onPress={() => onOpen(recordId, field)}
    >
      <Text style={s.link}>
        {field.status === "Reviewed" ? "Reviewed · " : ""}
        {field.issue}
      </Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.tileLabel}>{field.label}</Text>
      <ContractMath field={field} />
      {!field.checks &&
        field.evidence.map((e, i) => (
          <View style={s.evidence} key={i}>
            <Text style={s.amount}>{e.raw || "(blank)"}</Text>
            <Text style={s.file}>
              {e.file} · p{e.page}, line {e.line}
            </Text>
          </View>
        ))}
      {field.status === "Reviewed" && (
        <Text style={s.tileLabel}>Accepted value · {field.value}</Text>
      )}
    </Pressable>
  ));
}
const s = StyleSheet.create({
  panel: {
    backgroundColor: "#111111",
    borderRadius: 15,
    borderColor: "#383838",
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#fff", fontFamily: "WorkBold", fontSize: 19 },
  link: { color: "#E3B02F", fontWeight: "700", fontSize: 13 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    padding: 12,
    borderWidth: 1,
    borderColor: "#404040",
    backgroundColor: "#202020",
    borderRadius: 10,
    gap: 3,
  },
  num: { fontFamily: "WorkBold", fontSize: 32, color: "white" },
  tileLabel: { color: "#ededed", fontSize: 14 },
  empty: { color: "#b8b8b8", paddingVertical: 18 },
  item: {
    padding: 17,
    gap: 8,
    backgroundColor: "#1a1a1a",
    borderColor: "#383838",
    borderWidth: 1,
    borderRadius: 12,
  },
  evidence: {
    borderTopWidth: 1,
    borderColor: "#3a3a3a",
    paddingTop: 8,
    gap: 3,
  },
  amount: { color: "#fff", fontWeight: "700", fontSize: 17 },
  file: { color: "#c0c0c0", fontSize: 13 },
});

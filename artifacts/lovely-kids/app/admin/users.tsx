import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API_BASE } from "@/constants/api";

interface UserRow {
  id: string;
  name: string;
  phone: string | null;
  isAdmin: boolean;
  createdAt: string;
  clerkUserId: string | null;
  avatarUrl: string | null;
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

export default function AdminUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user: me, getAuthToken } = useAuth();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const fetchUsers = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/users`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
        setFetchError(null);
      } else {
        let msg = "فشل تحميل المستخدمين";
        if (res.status === 401 || res.status === 403) {
          msg = "غير مصرح — تأكد أن حسابك يملك صلاحية أدمن";
        } else {
          try {
            const body = await res.json();
            if (body?.error) msg = body.error;
          } catch { /* ignore */ }
        }
        setFetchError(msg);
        setUsers([]);
      }
    } catch {
      setFetchError("تعذّر الاتصال بالسيرفر");
      setUsers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAuthToken]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const deleteUser = async (id: string) => {
    setDeleteConfirmId(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/users/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
      }
    } catch {
      // ignore
    }
  };

  const deleteTarget = users.find((u) => u.id === deleteConfirmId);

  const renderItem = ({ item }: { item: UserRow }) => {
    const isSelf = item.id === me?.id;
    const isGoogle = !!item.clerkUserId && !item.phone;
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Avatar */}
        {item.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.primary + "22" }]}>
            <Ionicons name="person" size={22} color={colors.primary} />
          </View>
        )}

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.isAdmin && (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>أدمن</Text>
              </View>
            )}
            {isSelf && (
              <View style={[styles.badge, { backgroundColor: "#22c55e" }]}>
                <Text style={styles.badgeText}>أنت</Text>
              </View>
            )}
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {item.phone ?? (isGoogle ? "حساب جوجل / آبل" : "—")}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {timeAgo(item.createdAt)}
          </Text>
        </View>

        {/* Delete */}
        {!isSelf && (
          <Pressable
            onPress={() => setDeleteConfirmId(item.id)}
            style={styles.deleteBtn}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>المستخدمون</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{fetchError ? "—" : users.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchUsers(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              {fetchError ? (
                <>
                  <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
                  <Text style={[styles.emptyText, { color: "#ef4444", textAlign: "center" }]}>{fetchError}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="people-outline" size={48} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>لا يوجد مستخدمون</Text>
                </>
              )}
            </View>
          }
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteConfirmId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setDeleteConfirmId(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalIcon}>
              <Ionicons name="person-remove-outline" size={36} color="#ef4444" />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>حذف المستخدم</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
              {`هل أنت متأكد من حذف المستخدم "${deleteTarget?.name}"؟ سيتم حذف جميع جلساته. لا يمكن التراجع.`}
            </Text>
            <Pressable
              style={styles.confirmBtn}
              onPress={() => deleteConfirmId && deleteUser(deleteConfirmId)}
            >
              <Text style={styles.confirmBtnText}>حذف</Text>
            </Pressable>
            <Pressable
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setDeleteConfirmId(null)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>إلغاء</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  countBadge: { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  countBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyText: { fontSize: 16, fontWeight: "600" },
  list: { padding: 14, gap: 10 },
  card: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  info: { flex: 1, gap: 3, alignItems: "flex-end" },
  nameRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6, flexWrap: "wrap" },
  name: { fontSize: 14, fontWeight: "700" },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  meta: { fontSize: 12 },
  deleteBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center", gap: 8 },
  modalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ef444418", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalSub: { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 4 },
  confirmBtn: { width: "100%", backgroundColor: "#ef4444", paddingVertical: 12, borderRadius: 12, alignItems: "center", marginTop: 4 },
  confirmBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  cancelBtn: { width: "100%", borderWidth: 1, paddingVertical: 11, borderRadius: 12, alignItems: "center", marginTop: 4 },
  cancelBtnText: { fontSize: 14, fontWeight: "600" },
});

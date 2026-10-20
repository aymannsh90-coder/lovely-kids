import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_BASE } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";
import { useOrderEditSelection } from "@/context/OrderEditSelectionContext";
import { useProducts } from "@/context/ProductsContext";
import {
  isSizeOutOfStock,
  type Product,
} from "@/data/products";
import { useColors } from "@/hooks/useColors";

type OrderItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  color?: string;
};

type Order = {
  id: number;
  items: OrderItem[];
  totalPrice: number;
  status: string;
  shippingCost?: number | null;
  discountCodeAmount?: number | null;
  shippingPromotionDiscount?: number | null;
};

type EditableItem = OrderItem & {
  clientKey: string;
  originalColor?: string;
  originalSize?: string;
};

function oneParam(
  value: string | string[] | undefined,
) {
  return Array.isArray(value)
    ? value[0] ?? ""
    : value ?? "";
}

function lineKey(
  id: string,
  color?: string,
  size?: string,
) {
  return [
    id,
    color?.trim() ?? "",
    size?.trim() ?? "",
  ].join("::");
}

function editableFromOrder(
  items: OrderItem[],
): EditableItem[] {
  return items.map((item, index) => ({
    ...item,
    clientKey:
      `${item.id}-${index}-${Date.now()}`,
    originalColor: item.color,
    originalSize: item.size,
  }));
}

function productImageForSelection(
  product: Product,
  color?: string,
) {
  if (!color) return product.image;

  return (
    product.colorVariants?.find(
      (variant) => variant.color === color,
    )?.image?.trim() ||
    product.image
  );
}

function productKnownUnavailable(
  product: Product,
) {
  if (
    product.stock !== undefined &&
    product.stock !== null &&
    product.stock <= 0
  ) {
    return true;
  }

  if (
    product.colorVariants?.length
  ) {
    return product.colorVariants.every(
      (variant) =>
        variant.sizes.length > 0 &&
        variant.sizes.every(
          isSizeOutOfStock,
        ),
    );
  }

  return false;
}

export default function EditOrderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getAuthToken, loading: authLoading } =
    useAuth();
  const {
    products,
    loading: productsLoading,
    refreshProducts,
  } = useProducts();
  const {
    session: orderEditSelection,
    startSelection,
    clearSelection,
  } = useOrderEditSelection();

  const params = useLocalSearchParams<{
    id?: string | string[];
    token?: string | string[];
  }>();

  const id = Number(oneParam(params.id));
  const trackingToken =
    oneParam(params.token).trim();

  const [order, setOrder] =
    useState<Order | null>(null);
  const [items, setItems] =
    useState<EditableItem[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [success, setSuccess] =
    useState<string | null>(null);

  const [pickerOpen, setPickerOpen] =
    useState(false);
  const [search, setSearch] =
    useState("");
  const [pickerProduct, setPickerProduct] =
    useState<Product | null>(null);
  const [pickerColor, setPickerColor] =
    useState<string | undefined>();
  const [pickerSize, setPickerSize] =
    useState<string | undefined>();

  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          !product.isHidden &&
          !product.deletedAt,
      ),
    [products],
  );

  const productsById = useMemo(
    () =>
      new Map(
        visibleProducts.map((product) => [
          product.id,
          product,
        ]),
      ),
    [visibleProducts],
  );

  const merchandiseTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          item.price *
            item.quantity,
        0,
      ),
    [items],
  );

  const loadOrder = useCallback(
    async () => {
      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        setError("رقم الطلب غير صالح");
        setLoading(false);
        return;
      }

      if (
        !trackingToken &&
        authLoading
      ) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let found: Order | undefined;

        if (trackingToken) {
          const response =
            await fetch(
              `${API_BASE}/api/orders/${id}/track?token=${encodeURIComponent(
                trackingToken,
              )}`,
              { cache: "no-store" },
            );

          if (!response.ok) {
            const data =
              (await response
                .json()
                .catch(() => ({}))) as {
                error?: string;
              };

            throw new Error(
              data.error ??
                "تعذر فتح الطلب",
            );
          }

          found =
            (await response.json()) as Order;
        } else {
          const authToken =
            await getAuthToken();

          if (!authToken) {
            throw new Error(
              "يجب فتح الطلب من شاشة طلباتي",
            );
          }

          const response =
            await fetch(
              `${API_BASE}/api/orders/my`,
              {
                headers: {
                  Authorization:
                    `Bearer ${authToken}`,
                },
                cache: "no-store",
              },
            );

          if (!response.ok) {
            throw new Error(
              "تعذر تحميل الطلب",
            );
          }

          const myOrders =
            (await response.json()) as Order[];

          found = myOrders.find(
            (entry) =>
              entry.id === id,
          );

          if (!found) {
            throw new Error(
              "الطلب غير موجود",
            );
          }
        }

        setOrder(found);

        if (
          orderEditSelection?.orderId ===
          found.id
        ) {
          setItems(
            orderEditSelection.items.map(
              (item) => ({
                ...item,
              }),
            ),
          );
        } else {
          setItems(
            editableFromOrder(
              found.items,
            ),
          );
        }

        if (found.status !== "new") {
          setError(
            "تم تأكيد الطلب أو بدأت معالجته ولم يعد بالإمكان تعديله",
          );
        }
      } catch (loadError) {
        setOrder(null);
        setItems([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "تعذر تحميل الطلب",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      authLoading,
      getAuthToken,
      id,
      orderEditSelection,
      trackingToken,
    ],
  );

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const updateItem = useCallback(
    (
      clientKey: string,
      patch:
        | Partial<EditableItem>
        | ((
            current: EditableItem,
          ) => Partial<EditableItem>),
    ) => {
      setSuccess(null);
      setItems((current) =>
        current.map((item) => {
          if (
            item.clientKey !==
            clientKey
          ) {
            return item;
          }

          return {
            ...item,
            ...(typeof patch ===
            "function"
              ? patch(item)
              : patch),
          };
        }),
      );
    },
    [],
  );

  const removeItem = useCallback(
    (clientKey: string) => {
      setSuccess(null);
      setItems((current) => {
        if (current.length <= 1) {
          setError(
            "يجب أن يحتوي الطلب على منتج واحد على الأقل. لإزالة جميع المنتجات استخدم إلغاء الطلب.",
          );
          return current;
        }

        setError(null);

        return current.filter(
          (item) =>
            item.clientKey !==
            clientKey,
        );
      });
    },
    [],
  );

  const openPicker = useCallback(() => {
    if (!order) return;

    startSelection({
      orderId: order.id,
      trackingToken:
        trackingToken || undefined,
      items: items.map((item) => ({
        ...item,
      })),
    });

    router.push({
      pathname: "/(tabs)/products",
      params: {
        orderEdit: "1",
        orderId: String(order.id),
        ...(trackingToken
          ? {
              orderToken:
                trackingToken,
            }
          : {}),
      },
    });
  }, [
    items,
    order,
    startSelection,
    trackingToken,
  ]);

  const choosePickerProduct =
    useCallback((product: Product) => {
      setPickerProduct(product);

      const variants =
        product.colorVariants ?? [];

      if (
        variants.length === 1
      ) {
        const color =
          variants[0].color;

        setPickerColor(color);

        const sizes =
          variants[0].sizes;

        if (
          sizes.length === 1 &&
          !isSizeOutOfStock(
            sizes[0],
          )
        ) {
          setPickerSize(
            sizes[0].size,
          );
        } else {
          setPickerSize(undefined);
        }
      } else {
        setPickerColor(undefined);

        const sizes =
          product.sizes ?? [];

        setPickerSize(
          sizes.length === 1
            ? sizes[0]
            : undefined,
        );
      }
    }, []);

  const pickerSizes = useMemo(() => {
    if (!pickerProduct) {
      return [];
    }

    if (
      pickerProduct.colorVariants
        ?.length
    ) {
      return (
        pickerProduct.colorVariants.find(
          (variant) =>
            variant.color ===
            pickerColor,
        )?.sizes ?? []
      );
    }

    return (
      pickerProduct.sizes ?? []
    ).map((size) => ({
      size,
      outOfStock: false,
      stock: null,
    }));
  }, [
    pickerColor,
    pickerProduct,
  ]);

  const addPickedProduct =
    useCallback(() => {
      if (!pickerProduct) return;

      const variants =
        pickerProduct.colorVariants ??
        [];

      if (
        variants.length > 0 &&
        !pickerColor
      ) {
        setError(
          "اختر لون المنتج أولاً",
        );
        return;
      }

      if (
        pickerSizes.length > 0 &&
        !pickerSize
      ) {
        setError(
          "اختر المقاس أولاً",
        );
        return;
      }

      const key = lineKey(
        pickerProduct.id,
        pickerColor,
        pickerSize,
      );

      setItems((current) => {
        const existingIndex =
          current.findIndex(
            (item) =>
              lineKey(
                item.id,
                item.color,
                item.size,
              ) === key,
          );

        if (
          existingIndex >= 0
        ) {
          return current.map(
            (item, index) =>
              index ===
              existingIndex
                ? {
                    ...item,
                    quantity:
                      Math.min(
                        99,
                        item.quantity +
                          1,
                      ),
                  }
                : item,
          );
        }

        return [
          ...current,
          {
            id: pickerProduct.id,
            name:
              pickerProduct.nameAr ||
              pickerProduct.name,
            price:
              pickerProduct.price,
            quantity: 1,
            image:
              productImageForSelection(
                pickerProduct,
                pickerColor,
              ),
            color: pickerColor,
            size: pickerSize,
            clientKey:
              `new-${pickerProduct.id}-${Date.now()}`,
          },
        ];
      });

      setError(null);
      setSuccess(null);
      setPickerOpen(false);
      setPickerProduct(null);
      setPickerColor(undefined);
      setPickerSize(undefined);
    }, [
      pickerColor,
      pickerProduct,
      pickerSize,
      pickerSizes.length,
    ]);

  const save = useCallback(
    async () => {
      if (
        !order ||
        order.status !== "new" ||
        saving
      ) {
        return;
      }

      if (items.length < 1) {
        setError(
          "يجب أن يحتوي الطلب على منتج واحد على الأقل",
        );
        return;
      }

      setSaving(true);
      setError(null);
      setSuccess(null);

      try {
        const headers:
          Record<string, string> = {
            "Content-Type":
              "application/json",
          };

        const authToken =
          await getAuthToken();

        if (authToken) {
          headers.Authorization =
            `Bearer ${authToken}`;
        }

        const response =
          await fetch(
            `${API_BASE}/api/orders/${order.id}/customer-items`,
            {
              method: "PATCH",
              headers,
              body: JSON.stringify({
                items: items.map(
                  (item) => ({
                    id: item.id,
                    quantity:
                      item.quantity,
                    color:
                      item.color,
                    size: item.size,
                  }),
                ),
                trackingToken:
                  trackingToken ||
                  undefined,
              }),
            },
          );

        const data =
          (await response
            .json()
            .catch(() => ({}))) as
            | Order
            | {
                error?: string;
              };

        if (!response.ok) {
          throw new Error(
            "error" in data &&
              data.error
              ? data.error
              : "تعذر حفظ التعديلات",
          );
        }

        const updated =
          data as Order;

        setOrder(updated);
        setItems(
          editableFromOrder(
            updated.items,
          ),
        );
        setSuccess(
          "تم حفظ تعديلات الطلب بنجاح",
        );

        if (
          orderEditSelection?.orderId ===
          updated.id
        ) {
          clearSelection();
        }

        await refreshProducts();
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "تعذر حفظ التعديلات",
        );
      } finally {
        setSaving(false);
      }
    },
    [
      clearSelection,
      getAuthToken,
      items,
      order,
      orderEditSelection,
      refreshProducts,
      saving,
      trackingToken,
    ],
  );

  const filteredProducts =
    useMemo(() => {
      const normalized =
        search.trim().toLowerCase();

      if (!normalized) {
        return visibleProducts;
      }

      return visibleProducts.filter(
        (product) =>
          [
            product.nameAr,
            product.name,
            product.productCode,
            product.barcode,
          ].some(
            (value) =>
              typeof value ===
                "string" &&
              value
                .toLowerCase()
                .includes(
                  normalized,
                ),
          ),
      );
    }, [
      search,
      visibleProducts,
    ]);

  if (loading) {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor:
              colors.background,
          },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />
        <Text
          style={{
            color:
              colors.mutedForeground,
          }}
        >
          جاري تحميل الطلب...
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor:
            colors.background,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 10,
            backgroundColor:
              colors.primary,
          },
        ]}
      >
        <Pressable
          onPress={() =>
            router.back()
          }
          style={
            styles.headerButton
          }
        >
          <Ionicons
            name="arrow-forward"
            size={23}
            color="#fff"
          />
        </Pressable>

        <View
          style={{
            alignItems: "center",
          }}
        >
          <Text
            style={
              styles.headerTitle
            }
          >
            تعديل الطلب
          </Text>
          {order ? (
            <Text
              style={
                styles.headerSubtitle
              }
            >
              طلب #{order.id}
            </Text>
          ) : null}
        </View>

        <View
          style={
            styles.headerButton
          }
        />
      </View>

      {!order ? (
        <View
          style={styles.center}
        >
          <Ionicons
            name="alert-circle-outline"
            size={50}
            color={
              colors.mutedForeground
            }
          />
          <Text
            style={[
              styles.emptyTitle,
              {
                color:
                  colors.foreground,
              },
            ]}
          >
            تعذر فتح الطلب
          </Text>
          <Text
            style={[
              styles.emptyText,
              {
                color:
                  colors.mutedForeground,
              },
            ]}
          >
            {error ??
              "الطلب غير موجود"}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom:
                  insets.bottom +
                  150,
              },
            ]}
          >
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    colors.border,
                },
              ]}
            >
              <View
                style={
                  styles.infoTitleRow
                }
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={
                    colors.primary
                  }
                />
                <Text
                  style={[
                    styles.infoTitle,
                    {
                      color:
                        colors.foreground,
                    },
                  ]}
                >
                  التعديل متاح فقط
                  طالما الطلب جديد
                </Text>
              </View>
              <Text
                style={[
                  styles.infoText,
                  {
                    color:
                      colors.mutedForeground,
                  },
                ]}
              >
                عند الحفظ سيتم
                فحص المخزون من
                جديد وإعادة احتساب
                الخصم والتوصيل
                والإجمالي تلقائيًا.
              </Text>
            </View>

            {error ? (
              <View
                style={
                  styles.errorBox
                }
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color="#b91c1c"
                />
                <Text
                  style={
                    styles.errorText
                  }
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {success ? (
              <View
                style={
                  styles.successBox
                }
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color="#15803d"
                />
                <Text
                  style={
                    styles.successText
                  }
                >
                  {success}
                </Text>
              </View>
            ) : null}

            <View
              style={
                styles.sectionHeader
              }
            >
              <Text
                style={[
                  styles.sectionTitle,
                  {
                    color:
                      colors.foreground,
                  },
                ]}
              >
                المنتجات
              </Text>
              <Text
                style={[
                  styles.sectionCount,
                  {
                    color:
                      colors.mutedForeground,
                  },
                ]}
              >
                {items.length} صنف
              </Text>
            </View>

            {items.map(
              (item) => {
                const product =
                  productsById.get(
                    item.id,
                  );

                const variants =
                  product
                    ?.colorVariants ??
                  [];

                const activeVariant =
                  variants.find(
                    (variant) =>
                      variant.color ===
                      item.color,
                  );

                const sizes =
                  variants.length >
                  0
                    ? activeVariant
                        ?.sizes ?? []
                    : (
                        product
                          ?.sizes ?? []
                      ).map(
                        (size) => ({
                          size,
                          outOfStock:
                            false,
                          stock: null,
                        }),
                      );

                return (
                  <View
                    key={
                      item.clientKey
                    }
                    style={[
                      styles.itemCard,
                      {
                        backgroundColor:
                          colors.card,
                        borderColor:
                          colors.border,
                      },
                    ]}
                  >
                    <View
                      style={
                        styles.itemTop
                      }
                    >
                      {item.image ? (
                        <Image
                          source={{
                            uri:
                              item.image,
                          }}
                          style={
                            styles.itemImage
                          }
                        />
                      ) : (
                        <View
                          style={[
                            styles.itemImage,
                            {
                              backgroundColor:
                                colors.muted,
                              alignItems:
                                "center",
                              justifyContent:
                                "center",
                            },
                          ]}
                        >
                          <Ionicons
                            name="shirt-outline"
                            size={24}
                            color={
                              colors.mutedForeground
                            }
                          />
                        </View>
                      )}

                      <View
                        style={
                          styles.itemMain
                        }
                      >
                        <Text
                          style={[
                            styles.itemName,
                            {
                              color:
                                colors.foreground,
                            },
                          ]}
                          numberOfLines={
                            2
                          }
                        >
                          {item.name}
                        </Text>
                        <Text
                          style={[
                            styles.itemPrice,
                            {
                              color:
                                colors.primary,
                            },
                          ]}
                        >
                          {item.price}₪
                          للقطعة
                        </Text>
                      </View>

                      <Pressable
                        onPress={() =>
                          removeItem(
                            item.clientKey,
                          )
                        }
                        style={
                          styles.deleteButton
                        }
                      >
                        <Ionicons
                          name="trash-outline"
                          size={19}
                          color="#dc2626"
                        />
                      </Pressable>
                    </View>

                    {variants.length >
                    0 ? (
                      <View
                        style={
                          styles.optionGroup
                        }
                      >
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color:
                                colors.foreground,
                            },
                          ]}
                        >
                          اللون
                        </Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={
                            false
                          }
                          contentContainerStyle={
                            styles.chipsRow
                          }
                        >
                          {variants.map(
                            (
                              variant,
                            ) => {
                              const selected =
                                item.color ===
                                variant.color;

                              const knownUnavailable =
                                variant
                                  .sizes
                                  .length >
                                  0 &&
                                variant.sizes.every(
                                  isSizeOutOfStock,
                                ) &&
                                !(
                                  item.originalColor ===
                                  variant.color
                                );

                              return (
                                <Pressable
                                  key={
                                    variant.color
                                  }
                                  disabled={
                                    knownUnavailable
                                  }
                                  onPress={() => {
                                    const nextSizes =
                                      variant.sizes;

                                    let nextSize:
                                      | string
                                      | undefined =
                                      item.size;

                                    if (
                                      nextSizes.length >
                                        0 &&
                                      !nextSizes.some(
                                        (
                                          entry,
                                        ) =>
                                          entry.size ===
                                          nextSize &&
                                          (
                                            !isSizeOutOfStock(
                                              entry,
                                            ) ||
                                            (
                                              item.originalColor ===
                                                variant.color &&
                                              item.originalSize ===
                                                entry.size
                                            )
                                          ),
                                      )
                                    ) {
                                      nextSize =
                                        nextSizes.find(
                                          (
                                            entry,
                                          ) =>
                                            !isSizeOutOfStock(
                                              entry,
                                            ),
                                        )?.size;
                                    }

                                    updateItem(
                                      item.clientKey,
                                      {
                                        color:
                                          variant.color,
                                        size:
                                          nextSize,
                                        image:
                                          variant.image?.trim() ||
                                          product?.image ||
                                          item.image,
                                      },
                                    );
                                  }}
                                  style={[
                                    styles.chip,
                                    {
                                      borderColor:
                                        selected
                                          ? colors.primary
                                          : colors.border,
                                      backgroundColor:
                                        selected
                                          ? colors.primary +
                                            "12"
                                          : colors.background,
                                      opacity:
                                        knownUnavailable
                                          ? 0.4
                                          : 1,
                                    },
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.colorDot,
                                      {
                                        backgroundColor:
                                          variant.hex ||
                                          "#ddd",
                                      },
                                    ]}
                                  />
                                  <Text
                                    style={{
                                      color:
                                        selected
                                          ? colors.primary
                                          : colors.foreground,
                                      fontWeight:
                                        selected
                                          ? "800"
                                          : "600",
                                    }}
                                  >
                                    {
                                      variant.color
                                    }
                                  </Text>
                                </Pressable>
                              );
                            },
                          )}
                        </ScrollView>
                      </View>
                    ) : null}

                    {sizes.length > 0 ? (
                      <View
                        style={
                          styles.optionGroup
                        }
                      >
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color:
                                colors.foreground,
                            },
                          ]}
                        >
                          المقاس
                        </Text>
                        <View
                          style={
                            styles.wrapRow
                          }
                        >
                          {sizes.map(
                            (entry) => {
                              const selected =
                                item.size ===
                                entry.size;

                              const originalReservation =
                                item.originalColor ===
                                  item.color &&
                                item.originalSize ===
                                  entry.size;

                              const unavailable =
                                isSizeOutOfStock(
                                  entry,
                                ) &&
                                !originalReservation;

                              return (
                                <Pressable
                                  key={
                                    entry.size
                                  }
                                  disabled={
                                    unavailable
                                  }
                                  onPress={() =>
                                    updateItem(
                                      item.clientKey,
                                      {
                                        size:
                                          entry.size,
                                      },
                                    )
                                  }
                                  style={[
                                    styles.sizeChip,
                                    {
                                      borderColor:
                                        selected
                                          ? colors.primary
                                          : colors.border,
                                      backgroundColor:
                                        selected
                                          ? colors.primary +
                                            "12"
                                          : colors.background,
                                      opacity:
                                        unavailable
                                          ? 0.4
                                          : 1,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={{
                                      color:
                                        selected
                                          ? colors.primary
                                          : colors.foreground,
                                      fontWeight:
                                        selected
                                          ? "800"
                                          : "600",
                                    }}
                                  >
                                    {
                                      entry.size
                                    }
                                  </Text>
                                </Pressable>
                              );
                            },
                          )}
                        </View>
                      </View>
                    ) : null}

                    {!product ? (
                      <Text
                        style={[
                          styles.catalogNote,
                          {
                            color:
                              colors.mutedForeground,
                          },
                        ]}
                      >
                        هذا المنتج غير
                        ظاهر حاليًا في
                        الكتالوج؛ يمكنك
                        تعديل الكمية أو
                        حذفه فقط.
                      </Text>
                    ) : null}

                    <View
                      style={
                        styles.quantityRow
                      }
                    >
                      <Text
                        style={[
                          styles.optionLabel,
                          {
                            color:
                              colors.foreground,
                          },
                        ]}
                      >
                        الكمية
                      </Text>

                      <View
                        style={[
                          styles.counter,
                          {
                            borderColor:
                              colors.border,
                            backgroundColor:
                              colors.background,
                          },
                        ]}
                      >
                        <Pressable
                          disabled={
                            item.quantity <=
                            1
                          }
                          onPress={() =>
                            updateItem(
                              item.clientKey,
                              {
                                quantity:
                                  Math.max(
                                    1,
                                    item.quantity -
                                      1,
                                  ),
                              },
                            )
                          }
                          style={
                            styles.counterButton
                          }
                        >
                          <Ionicons
                            name="remove"
                            size={19}
                            color={
                              item.quantity <=
                              1
                                ? colors.mutedForeground
                                : colors.foreground
                            }
                          />
                        </Pressable>

                        <Text
                          style={[
                            styles.counterValue,
                            {
                              color:
                                colors.foreground,
                            },
                          ]}
                        >
                          {
                            item.quantity
                          }
                        </Text>

                        <Pressable
                          disabled={
                            item.quantity >=
                            99
                          }
                          onPress={() =>
                            updateItem(
                              item.clientKey,
                              {
                                quantity:
                                  Math.min(
                                    99,
                                    item.quantity +
                                      1,
                                  ),
                              },
                            )
                          }
                          style={
                            styles.counterButton
                          }
                        >
                          <Ionicons
                            name="add"
                            size={19}
                            color={
                              colors.foreground
                            }
                          />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              },
            )}

            {order.status ===
            "new" ? (
              <Pressable
                onPress={openPicker}
                style={[
                  styles.addButton,
                  {
                    borderColor:
                      colors.primary,
                    backgroundColor:
                      colors.primary +
                      "0D",
                  },
                ]}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={21}
                  color={
                    colors.primary
                  }
                />
                <Text
                  style={[
                    styles.addButtonText,
                    {
                      color:
                        colors.primary,
                    },
                  ]}
                >
                  إضافة منتج
                </Text>
              </Pressable>
            ) : null}

            <View
              style={[
                styles.summaryCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    colors.border,
                },
              ]}
            >
              <View
                style={
                  styles.summaryRow
                }
              >
                <Text
                  style={[
                    styles.summaryLabel,
                    {
                      color:
                        colors.mutedForeground,
                    },
                  ]}
                >
                  مجموع المنتجات
                  الحالي
                </Text>
                <Text
                  style={[
                    styles.summaryValue,
                    {
                      color:
                        colors.foreground,
                    },
                  ]}
                >
                  {merchandiseTotal}₪
                </Text>
              </View>

              <View
                style={
                  styles.summaryRow
                }
              >
                <Text
                  style={[
                    styles.summaryLabel,
                    {
                      color:
                        colors.mutedForeground,
                    },
                  ]}
                >
                  إجمالي الطلب
                  المحفوظ
                </Text>
                <Text
                  style={[
                    styles.summaryTotal,
                    {
                      color:
                        colors.primary,
                    },
                  ]}
                >
                  {order.totalPrice}₪
                </Text>
              </View>

              <Text
                style={[
                  styles.summaryHint,
                  {
                    color:
                      colors.mutedForeground,
                  },
                ]}
              >
                الإجمالي النهائي
                سيُعاد حسابه عند
                الحفظ حسب الخصم
                وعرض التوصيل
                الحاليين للطلب.
              </Text>
            </View>
          </ScrollView>

          {order.status ===
          "new" ? (
            <View
              style={[
                styles.saveBar,
                {
                  paddingBottom:
                    Math.max(
                      insets.bottom,
                      12,
                    ),
                  backgroundColor:
                    colors.card,
                  borderTopColor:
                    colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() =>
                  void save()
                }
                disabled={saving}
                style={[
                  styles.saveButton,
                  {
                    backgroundColor:
                      colors.primary,
                    opacity: saving
                      ? 0.65
                      : 1,
                  },
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    size="small"
                    color="#fff"
                  />
                ) : (
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={21}
                    color="#fff"
                  />
                )}

                <Text
                  style={
                    styles.saveButtonText
                  }
                >
                  {saving
                    ? "جاري حفظ التعديلات..."
                    : "حفظ التعديلات"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}

      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() =>
          setPickerOpen(false)
        }
      >
        <View
          style={[
            styles.modalScreen,
            {
              backgroundColor:
                colors.background,
              paddingTop:
                insets.top,
            },
          ]}
        >
          <View
            style={[
              styles.modalHeader,
              {
                backgroundColor:
                  colors.card,
                borderBottomColor:
                  colors.border,
              },
            ]}
          >
            <Pressable
              onPress={() => {
                if (
                  pickerProduct
                ) {
                  setPickerProduct(
                    null,
                  );
                  setPickerColor(
                    undefined,
                  );
                  setPickerSize(
                    undefined,
                  );
                } else {
                  setPickerOpen(
                    false,
                  );
                }
              }}
              style={
                styles.modalHeaderButton
              }
            >
              <Ionicons
                name="arrow-forward"
                size={23}
                color={
                  colors.foreground
                }
              />
            </Pressable>

            <Text
              style={[
                styles.modalTitle,
                {
                  color:
                    colors.foreground,
                },
              ]}
            >
              {pickerProduct
                ? "اختيار اللون والمقاس"
                : "إضافة منتج"}
            </Text>

            <View
              style={
                styles.modalHeaderButton
              }
            />
          </View>

          {pickerProduct ? (
            <ScrollView
              contentContainerStyle={
                styles.modalContent
              }
            >
              <View
                style={[
                  styles.pickerProductCard,
                  {
                    backgroundColor:
                      colors.card,
                    borderColor:
                      colors.border,
                  },
                ]}
              >
                <Image
                  source={{
                    uri:
                      productImageForSelection(
                        pickerProduct,
                        pickerColor,
                      ),
                  }}
                  style={
                    styles.pickerImage
                  }
                />
                <View
                  style={{
                    flex: 1,
                    gap: 5,
                  }}
                >
                  <Text
                    style={[
                      styles.itemName,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  >
                    {pickerProduct.nameAr ||
                      pickerProduct.name}
                  </Text>
                  <Text
                    style={[
                      styles.itemPrice,
                      {
                        color:
                          colors.primary,
                      },
                    ]}
                  >
                    {
                      pickerProduct.price
                    }
                    ₪
                  </Text>
                </View>
              </View>

              {(pickerProduct
                .colorVariants
                ?.length ??
                0) > 0 ? (
                <View
                  style={
                    styles.optionGroup
                  }
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  >
                    اختر اللون
                  </Text>
                  <View
                    style={
                      styles.wrapRow
                    }
                  >
                    {pickerProduct.colorVariants?.map(
                      (variant) => {
                        const unavailable =
                          variant
                            .sizes
                            .length >
                            0 &&
                          variant.sizes.every(
                            isSizeOutOfStock,
                          );

                        const selected =
                          pickerColor ===
                          variant.color;

                        return (
                          <Pressable
                            key={
                              variant.color
                            }
                            disabled={
                              unavailable
                            }
                            onPress={() => {
                              setPickerColor(
                                variant.color,
                              );
                              const available =
                                variant.sizes.filter(
                                  (
                                    entry,
                                  ) =>
                                    !isSizeOutOfStock(
                                      entry,
                                    ),
                                );

                              setPickerSize(
                                available.length ===
                                  1
                                  ? available[0]
                                      .size
                                  : undefined,
                              );
                            }}
                            style={[
                              styles.chip,
                              {
                                borderColor:
                                  selected
                                    ? colors.primary
                                    : colors.border,
                                backgroundColor:
                                  selected
                                    ? colors.primary +
                                      "12"
                                    : colors.card,
                                opacity:
                                  unavailable
                                    ? 0.4
                                    : 1,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.colorDot,
                                {
                                  backgroundColor:
                                    variant.hex ||
                                    "#ddd",
                                },
                              ]}
                            />
                            <Text
                              style={{
                                color:
                                  selected
                                    ? colors.primary
                                    : colors.foreground,
                                fontWeight:
                                  selected
                                    ? "800"
                                    : "600",
                              }}
                            >
                              {
                                variant.color
                              }
                            </Text>
                          </Pressable>
                        );
                      },
                    )}
                  </View>
                </View>
              ) : null}

              {pickerSizes.length >
              0 ? (
                <View
                  style={
                    styles.optionGroup
                  }
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color:
                          colors.foreground,
                      },
                    ]}
                  >
                    اختر المقاس
                  </Text>
                  <View
                    style={
                      styles.wrapRow
                    }
                  >
                    {pickerSizes.map(
                      (entry) => {
                        const unavailable =
                          isSizeOutOfStock(
                            entry,
                          );

                        const selected =
                          pickerSize ===
                          entry.size;

                        return (
                          <Pressable
                            key={
                              entry.size
                            }
                            disabled={
                              unavailable
                            }
                            onPress={() =>
                              setPickerSize(
                                entry.size,
                              )
                            }
                            style={[
                              styles.sizeChip,
                              {
                                borderColor:
                                  selected
                                    ? colors.primary
                                    : colors.border,
                                backgroundColor:
                                  selected
                                    ? colors.primary +
                                      "12"
                                    : colors.card,
                                opacity:
                                  unavailable
                                    ? 0.4
                                    : 1,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color:
                                  selected
                                    ? colors.primary
                                    : colors.foreground,
                                fontWeight:
                                  selected
                                    ? "800"
                                    : "600",
                              }}
                            >
                              {
                                entry.size
                              }
                            </Text>
                          </Pressable>
                        );
                      },
                    )}
                  </View>
                </View>
              ) : null}

              <Pressable
                onPress={
                  addPickedProduct
                }
                style={[
                  styles.saveButton,
                  {
                    backgroundColor:
                      colors.primary,
                    marginTop: 10,
                  },
                ]}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={21}
                  color="#fff"
                />
                <Text
                  style={
                    styles.saveButtonText
                  }
                >
                  إضافة للطلب
                </Text>
              </Pressable>
            </ScrollView>
          ) : (
            <>
              <View
                style={[
                  styles.searchBox,
                  {
                    backgroundColor:
                      colors.card,
                    borderColor:
                      colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={20}
                  color={
                    colors.mutedForeground
                  }
                />
                <TextInput
                  value={search}
                  onChangeText={
                    setSearch
                  }
                  placeholder="ابحث باسم المنتج أو الكود"
                  placeholderTextColor={
                    colors.mutedForeground
                  }
                  style={[
                    styles.searchInput,
                    {
                      color:
                        colors.foreground,
                    },
                  ]}
                  textAlign="right"
                />
              </View>

              {productsLoading ? (
                <View
                  style={
                    styles.center
                  }
                >
                  <ActivityIndicator
                    color={
                      colors.primary
                    }
                  />
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={
                    styles.productList
                  }
                >
                  {filteredProducts.map(
                    (product) => {
                      const unavailable =
                        productKnownUnavailable(
                          product,
                        );

                      return (
                        <Pressable
                          key={
                            product.id
                          }
                          disabled={
                            unavailable
                          }
                          onPress={() =>
                            choosePickerProduct(
                              product,
                            )
                          }
                          style={[
                            styles.productRow,
                            {
                              backgroundColor:
                                colors.card,
                              borderColor:
                                colors.border,
                              opacity:
                                unavailable
                                  ? 0.45
                                  : 1,
                            },
                          ]}
                        >
                          <Image
                            source={{
                              uri:
                                product.image,
                            }}
                            style={
                              styles.productRowImage
                            }
                          />

                          <View
                            style={{
                              flex: 1,
                              gap: 4,
                            }}
                          >
                            <Text
                              style={[
                                styles.productRowName,
                                {
                                  color:
                                    colors.foreground,
                                },
                              ]}
                              numberOfLines={
                                2
                              }
                            >
                              {product.nameAr ||
                                product.name}
                            </Text>
                            <Text
                              style={{
                                color:
                                  colors.primary,
                                fontWeight:
                                  "800",
                              }}
                            >
                              {
                                product.price
                              }
                              ₪
                            </Text>
                            {unavailable ? (
                              <Text
                                style={{
                                  color:
                                    "#dc2626",
                                  fontSize:
                                    12,
                                  fontWeight:
                                    "700",
                                }}
                              >
                                غير متوفر
                              </Text>
                            ) : null}
                          </View>

                          <Ionicons
                            name="chevron-back"
                            size={20}
                            color={
                              colors.mutedForeground
                            }
                          />
                        </Pressable>
                      );
                    },
                  )}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 7,
  },
  infoTitleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 7,
  },
  infoTitle: {
    flex: 1,
    textAlign: "right",
    fontSize: 14,
    fontWeight: "900",
  },
  infoText: {
    textAlign: "right",
    lineHeight: 20,
    fontSize: 12,
  },
  errorBox: {
    borderRadius: 13,
    padding: 12,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: "#991B1B",
    textAlign: "right",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  successBox: {
    borderRadius: 13,
    padding: 12,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  successText: {
    flex: 1,
    color: "#166534",
    textAlign: "right",
    fontSize: 13,
    fontWeight: "800",
  },
  sectionHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "700",
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 13,
  },
  itemTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  itemImage: {
    width: 68,
    height: 68,
    borderRadius: 12,
    resizeMode: "cover",
  },
  itemMain: {
    flex: 1,
    alignItems: "flex-end",
    gap: 5,
  },
  itemName: {
    textAlign: "right",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  itemPrice: {
    textAlign: "right",
    fontSize: 13,
    fontWeight: "800",
  },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  optionGroup: {
    gap: 8,
  },
  optionLabel: {
    textAlign: "right",
    fontSize: 13,
    fontWeight: "900",
  },
  chipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  wrapRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 7,
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.18)",
  },
  sizeChip: {
    minWidth: 56,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  catalogNote: {
    textAlign: "right",
    lineHeight: 18,
    fontSize: 12,
  },
  quantityRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  counter: {
    minWidth: 130,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  counterButton: {
    width: 42,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  counterValue: {
    minWidth: 38,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "900",
  },
  addButton: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    minHeight: 52,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: "900",
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 14,
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "900",
  },
  summaryTotal: {
    fontSize: 18,
    fontWeight: "900",
  },
  summaryHint: {
    textAlign: "right",
    fontSize: 11,
    lineHeight: 17,
  },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 11,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  emptyText: {
    textAlign: "center",
    lineHeight: 21,
    fontSize: 13,
  },
  modalScreen: {
    flex: 1,
  },
  modalHeader: {
    minHeight: 60,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalHeaderButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "900",
  },
  modalContent: {
    padding: 14,
    gap: 18,
    paddingBottom: 40,
  },
  pickerProductCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 11,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  pickerImage: {
    width: 84,
    height: 84,
    borderRadius: 14,
    resizeMode: "cover",
  },
  searchBox: {
    margin: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  productList: {
    padding: 14,
    paddingTop: 6,
    gap: 9,
    paddingBottom: 40,
  },
  productRow: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 11,
  },
  productRowImage: {
    width: 62,
    height: 62,
    borderRadius: 11,
    resizeMode: "cover",
  },
  productRowName: {
    textAlign: "right",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
});

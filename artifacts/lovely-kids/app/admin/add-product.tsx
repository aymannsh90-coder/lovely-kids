import { getResponsiveTopPadding } from "@/utils/webLayout";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { startWebBarcodeScanner } from "@/utils/webBarcodeScanner";
import {
  createProductQrLabelPreview,
  DEFAULT_QR_LABEL_LAYOUT,
  previewAndPrintProductQrs,
  type QrLabelElementId,
  type QrLabelLayout,
} from "@/utils/productQrPrint";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ColorPickerButton } from "@/components/ColorPickerButton";
import { useProducts } from "@/context/ProductsContext";
import { useAppSettings } from "@/context/AppSettingsContext";
import { useAuth } from "@/context/AuthContext";
import { CATEGORY_IDS, AGE_GROUP_IDS, DEFAULT_CATEGORY_LABELS, DEFAULT_AGE_GROUP_LABELS, DEFAULT_SEASON_LABELS, Product, ProductBarcode, ColorVariant, isSizeOutOfStock } from "@/data/products";
import { useColors } from "@/hooks/useColors";

import { API_BASE } from "@/constants/api";

export default function AddProductScreen() {
  const colors = useColors();
  const barcodeBeep = useAudioPlayer(require("../../assets/sounds/barcode-beep.wav"));
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { products, addProduct, updateProduct } = useProducts();
  const { settings } = useAppSettings();
  const { getAuthToken } = useAuth();
  const categoryLabels = settings.categoryLabels ?? DEFAULT_CATEGORY_LABELS;
  const ageGroupLabels = settings.ageGroupLabels ?? DEFAULT_AGE_GROUP_LABELS;
  const customCategories = settings.customCategories ?? [];
  const categories = [...CATEGORY_IDS.filter((id) => id !== "all"), ...customCategories].map((id) => ({
    id,
    label: categoryLabels[id] ?? DEFAULT_CATEGORY_LABELS[id] ?? id,
  }));
  const ageGroups = AGE_GROUP_IDS.map((id) => ({
    id,
    label: ageGroupLabels[id]?.label ?? DEFAULT_AGE_GROUP_LABELS[id].label,
  }));
  const seasons: { id: "summer" | "winter"; label: string }[] = [
    { id: "summer", label: DEFAULT_SEASON_LABELS.summer },
    { id: "winter", label: DEFAULT_SEASON_LABELS.winter },
  ];

  const editProduct = productId ? products.find((p) => p.id === productId) : null;
  const isEdit = !!editProduct;

  const [nameAr, setNameAr] = useState(editProduct?.nameAr ?? "");
  const [name, setName] = useState(editProduct?.name ?? "");
  const [productCode, setProductCode] = useState(editProduct?.productCode ?? "");
  const [barcode, setBarcode] = useState(editProduct?.barcode ?? "");
  const [additionalBarcodes, setAdditionalBarcodes] = useState<ProductBarcode[]>(
    editProduct?.additionalBarcodes ?? [],
  );
  const [additionalBarcodesExpanded, setAdditionalBarcodesExpanded] =
    useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const barcodeScanTargetRef = useRef<"primary" | number>("primary");
  const [barcodeScanned, setBarcodeScanned] = useState(false);
  const [price, setPrice] = useState(editProduct?.price?.toString() ?? "");
  const [originalPrice, setOriginalPrice] = useState(editProduct?.originalPrice?.toString() ?? "");
  const [image, setImage] = useState(editProduct?.image ?? "");
  const [images, setImages] = useState<string[]>(editProduct?.images ?? []);
  const [description, setDescription] = useState(editProduct?.description ?? "");
  const [category, setCategory] = useState(editProduct?.category ?? "clothes");
  const [ageGroup, setAgeGroup] = useState(editProduct?.ageGroup ?? "newborn");
  const [gender, setGender] = useState<"boys" | "girls" | null>(editProduct?.gender ?? null);
  const [season, setSeason] = useState<"summer" | "winter" | null>(editProduct?.season ?? null);
  const [isPinned, setIsPinned] = useState(editProduct?.isPinned ?? false);
  const [showInOffers, setShowInOffers] = useState(editProduct?.showInOffers ?? false);
  const [socialUrlInput, setSocialUrlInput] = useState("");
  const [facebookUrl, setFacebookUrl] = useState(editProduct?.facebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(editProduct?.instagramUrl ?? "");
  const [tiktokUrl, setTiktokUrl] = useState(editProduct?.tiktokUrl ?? "");
  const initialNewDays = editProduct?.isNew && editProduct?.newUntil ? Math.max(1, Math.ceil((new Date(editProduct.newUntil).getTime() - Date.now()) / 86400000)) : 7;
  const [isNew, setIsNew] = useState(editProduct?.isNew ?? false);
  const [newDays, setNewDays] = useState(String(initialNewDays));
  const [newDaysMode, setNewDaysMode] = useState<"7" | "14" | "custom">(initialNewDays === 7 ? "7" : initialNewDays === 14 ? "14" : "custom");
  const [newDurationChanged, setNewDurationChanged] = useState(false);
  const [stock, setStock] = useState(
    editProduct?.stock !== undefined && editProduct?.stock !== null
      ? editProduct.stock.toString()
      : ""
  );
  const [sizes, setSizes] = useState<string[]>(editProduct?.sizes ?? []);
  const [sizeInput, setSizeInput] = useState("");
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>(editProduct?.colorVariants ?? []);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#EF4444");
  const [colorSizeInputs, setColorSizeInputs] = useState<Record<number, string>>({});
  const [colorSizeQtyInputs, setColorSizeQtyInputs] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [qrGenerateOpen, setQrGenerateOpen] = useState(false);
  const [qrGenerationMessage, setQrGenerationMessage] = useState("");
  const [printingQrs, setPrintingQrs] = useState(false);
  const [qrPrintOpen, setQrPrintOpen] = useState(false);
  const [qrPrintSelected, setQrPrintSelected] = useState<Record<string, boolean>>({});
  const [qrPrintCopies, setQrPrintCopies] = useState<Record<string, string>>({});
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false);
  const [qrPreviewUri, setQrPreviewUri] = useState("");
  const [qrPreviewItem, setQrPreviewItem] =
    useState<ProductBarcode | null>(null);

  const [qrLabelLayout, setQrLabelLayout] =
    useState<QrLabelLayout>(() =>
      JSON.parse(
        JSON.stringify(
          DEFAULT_QR_LABEL_LAYOUT,
        ),
      ),
    );

  const [
    qrLabelSelectedElement,
    setQrLabelSelectedElement,
  ] = useState<QrLabelElementId>("qr");

  const [
    qrLabelLayoutMessage,
    setQrLabelLayoutMessage,
  ] = useState("");

  const qrLabelPreviewSize = useRef({
    width: 384,
    height: 195,
  });

  const qrLabelDrag = useRef<{
    element: QrLabelElementId | null;
    pageX: number;
    pageY: number;
    startX: number;
    startY: number;
  }>({
    element: null,
    pageX: 0,
    pageY: 0,
    startX: 0,
    startY: 0,
  });
  const topPadding = getResponsiveTopPadding(insets.top);
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  useEffect(() => {
    if (Platform.OS !== "web") return;

    try {
      const storage =
        (globalThis as any).localStorage;

      const saved =
        storage?.getItem(
          "lovely_kids_qr_label_layout_v1",
        );

      if (!saved) return;

      const parsed =
        JSON.parse(saved);

      const next =
        JSON.parse(
          JSON.stringify(
            DEFAULT_QR_LABEL_LAYOUT,
          ),
        ) as QrLabelLayout;

      (
        Object.keys(next) as
          QrLabelElementId[]
      ).forEach((elementId) => {
        if (
          parsed?.[elementId] &&
          typeof parsed[elementId] ===
            "object"
        ) {
          next[elementId] = {
            ...next[elementId],
            ...parsed[elementId],
          };
        }
      });

      setQrLabelLayout(next);
    } catch {
      // Ignore invalid saved editor data.
    }
  }, []);

  const normalizeVariantPart = (value?: string | null) =>
    (value ?? "").trim().toLocaleLowerCase();

  const sameQrVariant = (
    item: ProductBarcode,
    color?: string | null,
    size?: string | null,
  ) =>
    normalizeVariantPart(item.color) === normalizeVariantPart(color) &&
    normalizeVariantPart(item.size) === normalizeVariantPart(size);

  const buildGeneratedVariantQrValue = (
    id: string,
    color?: string | null,
    size?: string | null,
  ) => {
    const source = [
      id,
      normalizeVariantPart(color),
      normalizeVariantPart(size),
    ].join("|");

    let hash = 2166136261;

    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }

    const cleanId =
      id.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase() || "0";

    const hashPart = hash
      .toString(36)
      .toUpperCase()
      .padStart(7, "0");

    return `LKQR-${cleanId}-${hashPart}`;
  };

  const getQrVariantCombinations = () => {
    const combinations: Array<{
      color: string | null;
      size: string | null;
    }> = [];

    if (colorVariants.length > 0) {
      colorVariants.forEach((variant) => {
        const cleanColor = variant.color.trim();

        if (variant.sizes.length > 0) {
          variant.sizes.forEach((sizeEntry) => {
            const cleanSize = sizeEntry.size.trim();

            if (!cleanSize) return;

            combinations.push({
              color: cleanColor || null,
              size: cleanSize,
            });
          });
        } else if (cleanColor) {
          combinations.push({
            color: cleanColor,
            size: null,
          });
        }
      });
    } else if (sizes.length > 0) {
      sizes.forEach((sizeValue) => {
        const cleanSize = sizeValue.trim();

        if (!cleanSize) return;

        combinations.push({
          color: null,
          size: cleanSize,
        });
      });
    } else {
      combinations.push({
        color: null,
        size: null,
      });
    }

    return combinations.filter(
      (item, index, all) =>
        all.findIndex((candidate) =>
          sameQrVariant(
            {
              barcode: "",
              color: candidate.color,
              size: candidate.size,
            },
            item.color,
            item.size,
          ),
        ) === index,
    );
  };

  const getGeneratedQrBarcodes = () =>
    additionalBarcodes.filter((item) =>
      item.barcode.trim().startsWith("LKQR-"),
    );

  const getQrStockQuantity = (
    item: ProductBarcode,
  ): number | null => {
    if (item.color && item.size) {
      const variant = colorVariants.find(
        (entry) =>
          normalizeVariantPart(entry.color) ===
          normalizeVariantPart(item.color),
      );

      const sizeEntry = variant?.sizes.find(
        (entry) =>
          normalizeVariantPart(entry.size) ===
          normalizeVariantPart(item.size),
      );

      if (
        sizeEntry?.stock !== undefined &&
        sizeEntry?.stock !== null
      ) {
        return Math.max(
          0,
          Math.floor(sizeEntry.stock),
        );
      }
    }

    if (!item.color && !item.size) {
      const currentGeneralStock =
        stock.trim() &&
        !Number.isNaN(Number(stock))
          ? Number(stock)
          : editProduct?.stock;

      if (
        currentGeneralStock !== undefined &&
        currentGeneralStock !== null
      ) {
        return Math.max(
          0,
          Math.floor(currentGeneralStock),
        );
      }
    }

    return null;
  };

  const openQrPrintOptions = () => {
    const generated = getGeneratedQrBarcodes();

    if (generated.length === 0) {
      setQrGenerationMessage(
        "لا يوجد QR مولّد لهذا الموديل. ولّد الرموز أولاً.",
      );
      return;
    }

    const selected: Record<string, boolean> = {};
    const copies: Record<string, string> = {};

    generated.forEach((item) => {
      const stockQty = getQrStockQuantity(item);
      const outOfStock = stockQty === 0;

      selected[item.barcode] = !outOfStock;
      copies[item.barcode] = outOfStock ? "0" : "1";
    });

    setQrPrintSelected(selected);
    setQrPrintCopies(copies);
    setQrGenerationMessage("");
    setQrPrintOpen(true);
  };

  const selectAllQrPrintRows = (
    selected: boolean,
  ) => {
    const next: Record<string, boolean> = {};

    getGeneratedQrBarcodes().forEach((item) => {
      const stockQty = getQrStockQuantity(item);

      next[item.barcode] =
        selected && stockQty !== 0;
    });

    setQrPrintSelected(next);
  };

  const applyQrCopiesFromStock = () => {
    setQrPrintCopies((previous) => {
      const next = { ...previous };

      getGeneratedQrBarcodes().forEach((item) => {
        const quantity =
          getQrStockQuantity(item);

        if (quantity !== null) {
          next[item.barcode] =
            String(quantity);
        } else if (!next[item.barcode]) {
          next[item.barcode] = "1";
        }
      });

      return next;
    });
  };

  const getSelectedQrLabels = () =>
    getGeneratedQrBarcodes().flatMap(
      (item) => {
        if (!qrPrintSelected[item.barcode]) {
          return [];
        }

        const stockQty =
          getQrStockQuantity(item);

        // QR stays saved, but zero-stock items are never printed.
        if (stockQty === 0) {
          return [];
        }

        const requestedCopies =
          Number.parseInt(
            qrPrintCopies[item.barcode] || "0",
            10,
          );

        const copies =
          Number.isFinite(requestedCopies)
            ? Math.max(
                0,
                Math.min(999, requestedCopies),
              )
            : 0;

        if (copies <= 0) {
          return [];
        }

        return Array.from(
          { length: copies },
          () => ({ ...item }),
        );
      },
    );

  const getQrPrintProductData = (
    selectedBarcodes: ProductBarcode[],
  ) => ({
    nameAr:
      nameAr.trim() ||
      editProduct?.nameAr ||
      "",

    productCode:
      productCode.trim() ||
      editProduct?.productCode ||
      null,

    price:
      price.trim() &&
      !Number.isNaN(Number(price))
        ? Number(price)
        : editProduct?.price ?? 0,

    barcodes: selectedBarcodes,
  });

  const qrLabelElementNames:
    Record<QrLabelElementId, string> = {
      qr: "QR",
      brand: "Lovely Kids",
      name: "اسم المنتج",
      code: "الكود",
      color: "اللون",
      variantSize: "النمرة",
      price: "السعر",
    };

  const refreshQrLabelPreview = (
    nextLayout: QrLabelLayout,
    item: ProductBarcode | null =
      qrPreviewItem,
  ) => {
    if (!item) return;

    try {
      const previewUri =
        createProductQrLabelPreview(
          getQrPrintProductData([item]),
          nextLayout,
        );

      setQrPreviewUri(previewUri);
    } catch {
      // Keep the previous preview if rendering fails.
    }
  };

  const updateQrLabelElement = (
    elementId: QrLabelElementId,
    patch: Partial<
      QrLabelLayout[QrLabelElementId]
    >,
  ) => {
    const next: QrLabelLayout = {
      ...qrLabelLayout,
      [elementId]: {
        ...qrLabelLayout[elementId],
        ...patch,
      },
    };

    setQrLabelLayout(next);
    refreshQrLabelPreview(next);
    setQrLabelLayoutMessage("");
  };

  const changeQrLabelElementPosition = (
    dx: number,
    dy: number,
  ) => {
    const current =
      qrLabelLayout[
        qrLabelSelectedElement
      ];

    updateQrLabelElement(
      qrLabelSelectedElement,
      {
        x: Math.round(
          Math.max(
            -190,
            Math.min(
              190,
              current.x + dx,
            ),
          ),
        ),
        y: Math.round(
          Math.max(
            -190,
            Math.min(
              190,
              current.y + dy,
            ),
          ),
        ),
      },
    );
  };

  const changeQrLabelElementSize = (
    direction: number,
  ) => {
    const elementId =
      qrLabelSelectedElement;

    const current =
      qrLabelLayout[elementId];

    const step =
      elementId === "qr"
        ? 8
        : 1;

    const minimum =
      elementId === "qr"
        ? 110
        : 8;

    const maximum =
      elementId === "qr"
        ? 190
        : 42;

    updateQrLabelElement(
      elementId,
      {
        size: Math.max(
          minimum,
          Math.min(
            maximum,
            current.size +
              direction * step,
          ),
        ),
      },
    );
  };

  const setQrLabelNumericValue = (
    field: "x" | "y" | "size",
    rawValue: string,
  ) => {
    const clean =
      rawValue.trim();

    if (
      clean === "" ||
      clean === "-"
    ) {
      return;
    }

    const numericValue =
      Number(clean);

    if (
      !Number.isFinite(
        numericValue,
      )
    ) {
      return;
    }

    const elementId =
      qrLabelSelectedElement;

    if (
      field === "x" ||
      field === "y"
    ) {
      updateQrLabelElement(
        elementId,
        {
          [field]: Math.round(
            Math.max(
              -190,
              Math.min(
                190,
                numericValue,
              ),
            ),
          ),
        },
      );

      return;
    }

    const minimum =
      elementId === "qr"
        ? 110
        : 8;

    const maximum =
      elementId === "qr"
        ? 190
        : 42;

    updateQrLabelElement(
      elementId,
      {
        size: Math.round(
          Math.max(
            minimum,
            Math.min(
              maximum,
              numericValue,
            ),
          ),
        ),
      },
    );
  };

  const toggleQrLabelTextStyle = (
    field: "bold" | "italic" | "underline" | "inverted",
  ) => {
    const elementId =
      qrLabelSelectedElement;

    if (elementId === "qr") {
      return;
    }

    updateQrLabelElement(
      elementId,
      {
        [field]:
          !qrLabelLayout[
            elementId
          ][field],
      },
    );
  };

  const saveQrLabelLayout = () => {
    if (Platform.OS !== "web") {
      setQrLabelLayoutMessage(
        "حفظ التصميم متاح من المتصفح.",
      );
      return;
    }

    try {
      const storage =
        (globalThis as any).localStorage;

      storage?.setItem(
        "lovely_kids_qr_label_layout_v1",
        JSON.stringify(
          qrLabelLayout,
        ),
      );

      setQrLabelLayoutMessage(
        "✓ تم حفظ تصميم الملصق على هذا الكمبيوتر.",
      );
    } catch {
      setQrLabelLayoutMessage(
        "تعذر حفظ التصميم.",
      );
    }
  };

  const resetQrLabelLayout = () => {
    const next =
      JSON.parse(
        JSON.stringify(
          DEFAULT_QR_LABEL_LAYOUT,
        ),
      ) as QrLabelLayout;

    setQrLabelLayout(next);
    refreshQrLabelPreview(next);

    setQrLabelLayoutMessage(
      "تمت إعادة التصميم الأصلي. اضغط حفظ لتثبيته.",
    );
  };

  const getQrLabelEditorBox = (
    elementId: QrLabelElementId,
  ) => {
    const element =
      qrLabelLayout[elementId];

    const bases = {
      qr: {
        left: 0,
        top: 0,
        width: 190,
        height: 195,
      },
      brand: {
        left: 198,
        top: 2,
        width: 178,
        height: 36,
      },
      name: {
        left: 198,
        top: 36,
        width: 178,
        height: 30,
      },
      code: {
        left: 198,
        top: 68,
        width: 178,
        height: 27,
      },
      color: {
        left: 198,
        top: 94,
        width: 178,
        height: 26,
      },
      variantSize: {
        left: 198,
        top: 118,
        width: 178,
        height: 27,
      },
      price: {
        left: 198,
        top: 145,
        width: 178,
        height: 43,
      },
    };

    const base = bases[elementId];

    return {
      left:
        ((base.left + element.x) /
          384) *
        100,
      top:
        ((base.top + element.y) /
          195) *
        100,
      width:
        (base.width / 384) * 100,
      height:
        (base.height / 195) * 100,
    };
  };

  const beginQrLabelDrag = (
    elementId: QrLabelElementId,
    event: any,
  ) => {
    setQrLabelSelectedElement(
      elementId,
    );

    const element =
      qrLabelLayout[elementId];

    qrLabelDrag.current = {
      element: elementId,
      pageX:
        event.nativeEvent.pageX ?? 0,
      pageY:
        event.nativeEvent.pageY ?? 0,
      startX: element.x,
      startY: element.y,
    };
  };

  const moveQrLabelDrag = (
    event: any,
  ) => {
    const drag =
      qrLabelDrag.current;

    if (!drag.element) return;

    const width =
      qrLabelPreviewSize.current
        .width || 384;

    const height =
      qrLabelPreviewSize.current
        .height || 195;

    const currentPageX =
      event.nativeEvent.pageX ??
      drag.pageX;

    const currentPageY =
      event.nativeEvent.pageY ??
      drag.pageY;

    const dx =
      ((currentPageX -
        drag.pageX) /
        width) *
      384;

    const dy =
      ((currentPageY -
        drag.pageY) /
        height) *
      195;

    updateQrLabelElement(
      drag.element,
      {
        x: Math.round(
          drag.startX + dx,
        ),
        y: Math.round(
          drag.startY + dy,
        ),
      },
    );
  };

  const endQrLabelDrag = () => {
    qrLabelDrag.current.element =
      null;
  };

  const handleQrLabelPreview = () => {
    if (!editProduct) return;

    const selectedBarcodes =
      getSelectedQrLabels();

    if (selectedBarcodes.length === 0) {
      setQrGenerationMessage(
        "اختر لون أو نمرة واحدة على الأقل وحدد عدد نسخ أكبر من صفر.",
      );
      return;
    }

    try {
      setQrGenerationMessage("");

      const previewItem =
        selectedBarcodes[0];

      const previewUri =
        createProductQrLabelPreview(
          getQrPrintProductData([
            previewItem,
          ]),
          qrLabelLayout,
        );

      setQrPreviewItem(previewItem);
      setQrPreviewUri(previewUri);
      setQrPrintOpen(false);
      setQrPreviewOpen(true);
    } catch (error) {
      setQrGenerationMessage(
        error instanceof Error
          ? error.message
          : "تعذر إنشاء معاينة الملصق.",
      );
    }
  };

  const handlePreviewAndPrintQrs = async () => {
    if (!editProduct) return;

    const selectedBarcodes =
      getSelectedQrLabels();

    if (selectedBarcodes.length === 0) {
      setQrGenerationMessage(
        "اختر لون أو نمرة واحدة على الأقل وحدد عدد نسخ أكبر من صفر.",
      );
      return;
    }

    try {
      setPrintingQrs(true);
      setQrGenerationMessage("");

      const count =
        await previewAndPrintProductQrs(
          getQrPrintProductData(
            selectedBarcodes,
          ),
          qrLabelLayout,
        );

      setQrPrintOpen(false);
      setQrPreviewOpen(false);

      setQrGenerationMessage(
        `✓ تمت طباعة ${count} ملصق QR مباشرة.`,
      );
    } catch (error) {
      setQrGenerationMessage(
        error instanceof Error
          ? error.message
          : "فشلت الطباعة المباشرة.",
      );
    } finally {
      setPrintingQrs(false);
    }
  };


  const handleGenerateVariantQrs = (
    mode: "missing" | "all",
  ) => {
    if (!editProduct) return;

    const combinations = getQrVariantCombinations();

    const current = additionalBarcodes.filter(
      (item) => item.barcode.trim().length > 0,
    );

    const reservedValues = new Set(
      [
        barcode.trim(),
        ...current.map((item) => item.barcode.trim()),
      ].filter(Boolean),
    );

    const generated: ProductBarcode[] = [];

    combinations.forEach((combination) => {
      const alreadyCovered = current.some((item) =>
        sameQrVariant(
          item,
          combination.color,
          combination.size,
        ),
      );

      if (mode === "missing" && alreadyCovered) {
        return;
      }

      const qrValue = buildGeneratedVariantQrValue(
        editProduct.id,
        combination.color,
        combination.size,
      );

      if (reservedValues.has(qrValue)) {
        return;
      }

      reservedValues.add(qrValue);

      generated.push({
        barcode: qrValue,
        color: combination.color,
        size: combination.size,
      });
    });

    if (generated.length === 0) {
      setQrGenerationMessage(
        mode === "missing"
          ? "✓ جميع الألوان والنمر لديها رمز QR."
          : "✓ رموز QR التلقائية للموديل موجودة بالفعل.",
      );

      setQrGenerateOpen(false);
      return;
    }

    setAdditionalBarcodes((previous) => [
      ...previous,
      ...generated,
    ]);

    setQrGenerationMessage(
      `✓ تم تجهيز ${generated.length} رمز QR. اضغط "حفظ التعديلات" لتثبيتها.`,
    );

    setQrGenerateOpen(false);
  };

  const addAdditionalBarcode = () => {
    setAdditionalBarcodes((prev) => [
      ...prev,
      { barcode: "", color: null, size: null },
    ]);
  };

  const updateAdditionalBarcode = (
    index: number,
    updates: Partial<ProductBarcode>,
  ) => {
    setAdditionalBarcodes((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, ...updates } : item
      )
    );
  };

  const removeAdditionalBarcode = (index: number) => {
    setAdditionalBarcodes((prev) =>
      prev.filter((_, i) => i !== index)
    );
  };

  const getAdditionalBarcodeSizeOptions = (item: ProductBarcode) => {
    if (!item.color) return sizes;

    return (
      colorVariants
        .find((variant) => variant.color === item.color)
        ?.sizes.map((entry) => entry.size) ?? []
    );
  };

  const addSize = () => {
    const s = sizeInput.trim().toUpperCase();
    if (!s) return;
    if (sizes.includes(s)) { setSizeInput(""); return; }
    setSizes((prev) => [...prev, s]);
    setSizeInput("");
  };

  const removeSize = (s: string) => setSizes((prev) => prev.filter((x) => x !== s));

  const addColorVariant = () => {
    const name = newColorName.trim();
    if (!name) return;
    if (colorVariants.some((c) => c.color === name)) { setNewColorName(""); return; }
    setColorVariants((prev) => {
      const templateSizes = prev[0]?.sizes.map((s) => ({
        size: s.size,
        stock: 0,
        outOfStock: true,
      })) ?? [];

      return [...prev, { color: name, hex: newColorHex, sizes: templateSizes }];
    });
    setNewColorName("");
  };

  const removeColorVariant = (idx: number) => {
    const removedUrl = colorVariants[idx]?.image;

    const usedByAnotherColor = removedUrl
      ? colorVariants.some((c, i) => i !== idx && c.image === removedUrl)
      : false;

    setColorVariants((prev) => prev.filter((_, i) => i !== idx));

    if (removedUrl && !usedByAnotherColor) {
      setImages((prev) => {
        const updated = prev.filter((url) => url !== removedUrl);

        if (image === removedUrl) {
          setImage(updated[0] ?? "");
        }

        return updated;
      });
    }
  };

  const addSizeToColor = (idx: number) => {
    const raw = (colorSizeInputs[idx] ?? "").trim().toUpperCase();
    if (!raw) return;
    const qtyRaw = (colorSizeQtyInputs[idx] ?? "").trim();
    const qty = qtyRaw ? Math.max(0, Math.round(Number(qtyRaw))) : null;
    setColorVariants((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        if (c.sizes.some((s) => s.size === raw)) return c;
        return { ...c, sizes: [...c.sizes, { size: raw, stock: qty, outOfStock: qty === 0 }] };
      })
    );
    setColorSizeInputs((prev) => ({ ...prev, [idx]: "" }));
    setColorSizeQtyInputs((prev) => ({ ...prev, [idx]: "" }));
  };

  const removeSizeFromColor = (idx: number, size: string) => {
    setColorVariants((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, sizes: c.sizes.filter((s) => s.size !== size) }))
    );
  };

  const updateSizeStock = (idx: number, size: string, value: string) => {
    const trimmed = value.trim();
    const qty = trimmed === "" ? null : Math.max(0, Math.round(Number(trimmed)) || 0);
    setColorVariants((prev) =>
      prev.map((c, i) =>
        i !== idx
          ? c
          : {
              ...c,
              sizes: c.sizes.map((s) =>
                s.size === size ? { ...s, stock: qty, outOfStock: qty === 0 } : s
              ),
            }
      )
    );
  };

  const handlePickColorImage = async (idx: number) => {
    const previousUrl = colorVariants[idx]?.image;
    const previousImageIndex = previousUrl ? images.indexOf(previousUrl) : -1;
    const needsNewGallerySlot = previousImageIndex < 0;

    if (needsNewGallerySlot && images.length >= 8) {
      setErrors(["يمكنك إضافة حتى 8 صور للمنتج"]);
      return;
    }

    const url = await uploadImage();
    if (!url) return;

    setColorVariants((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, image: url }))
    );

    setImages((prev) => {
      if (previousUrl) {
        const previousIndex = prev.indexOf(previousUrl);
        if (previousIndex >= 0) {
          const updated = [...prev];
          updated[previousIndex] = url;
          return [...new Set(updated)];
        }
      }

      if (prev.includes(url)) return prev;
      if (prev.length >= 8) return prev;
      return [...prev, url];
    });

    if (!image || image === previousUrl) {
      setImage(url);
    }
  };

  const removeColorImage = (idx: number) => {
    const removedUrl = colorVariants[idx]?.image;
    if (!removedUrl) return;

    const usedByAnotherColor = colorVariants.some(
      (c, i) => i !== idx && c.image === removedUrl
    );

    setColorVariants((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, image: undefined }))
    );

    if (!usedByAnotherColor) {
      const updatedImages = images.filter((url) => url !== removedUrl);
      setImages(updatedImages);

      if (image === removedUrl) {
        setImage(updatedImages[0] ?? "");
      }
    }
  };

  const uploadImage = async (): Promise<string | null> => {
    if (uploading || isCompressing) return null;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrors(["يجب السماح بالوصول إلى الصور لرفع صورة المنتج"]);
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      base64: Platform.OS === "web",
    });

    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];

    setIsCompressing(true);
    setErrors([]);
    let finalBase64: string | undefined;
    const finalMimeType = "image/jpeg";

    try {
      if (Platform.OS === "web") {
        // Web: canvas-based compression
        const dataUri = asset.uri;
        const compressed = await new Promise<{ base64: string }>((resolve, reject) => {
          const img = new (globalThis as unknown as { Image: new () => HTMLImageElement }).Image();
          img.onload = () => {
            const MAX = 1200;
            const scale = Math.min(1, MAX / Math.max(img.width || MAX, img.height || MAX));
            const w = Math.max(1, Math.round((img.width || MAX) * scale));
            const h = Math.max(1, Math.round((img.height || MAX) * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("canvas غير متوفر")); return; }
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
            resolve({ base64: dataUrl.split(",")[1] });
          };
          img.onerror = () => reject(new Error("تعذّر تحميل الصورة"));
          img.src = dataUri;
        });
        finalBase64 = compressed.base64;
      } else {
        // Native: expo-image-manipulator
        const MAX = 1200;
        const w = asset.width ?? MAX;
        const h = asset.height ?? MAX;
        const actions: Parameters<typeof manipulateAsync>[1] = [];
        if (Math.max(w, h) > MAX) {
          const scale = MAX / Math.max(w, h);
          actions.push({ resize: { width: Math.round(w * scale), height: Math.round(h * scale) } });
        }
        const compressed = await manipulateAsync(
          asset.uri,
          actions,
          { compress: 0.75, format: SaveFormat.JPEG, base64: true },
        );
        if (!compressed.base64) throw new Error("الضغط لم ينتج base64");
        finalBase64 = compressed.base64;
      }
    } catch (compErr) {
      setIsCompressing(false);
      const msg = compErr instanceof Error ? compErr.message : "فشل ضغط الصورة";
      setErrors([`فشل ضغط الصورة: ${msg}`]);
      return null;
    }
    setIsCompressing(false);

    if (!finalBase64) {
      setErrors(["تعذّر قراءة الصورة، جرب صورة أخرى"]);
      return null;
    }

    setUploading(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("يجب تسجيل الدخول كمشرف");
      const res = await fetch(`${API_BASE}/api/images/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64: finalBase64, mimeType: finalMimeType }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "فشل الرفع");
      }

      const data = await res.json() as { url: string };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return data.url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "فشل رفع الصورة";
      setErrors([msg]);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleAddImage = async () => {
    const url = await uploadImage();
    if (!url) return;
    if (!image) {
      setImage(url);
    }
    setImages((prev) => [...prev, url]);
  };

  const handleReplaceImage = async (index: number) => {
    const previousUrl = images[index];
    if (!previousUrl) return;

    const url = await uploadImage();
    if (!url) return;

    setImages((prev) => {
      const updated = [...prev];
      updated[index] = url;
      return updated;
    });

    setColorVariants((prev) =>
      prev.map((c) =>
        c.image === previousUrl ? { ...c, image: url } : c
      )
    );

    if (image === previousUrl) {
      setImage(url);
    }
  };

  const handleRemoveImage = (index: number) => {
    const removedUrl = images[index];
    if (!removedUrl) return;

    setColorVariants((prev) =>
      prev.map((c) =>
        c.image === removedUrl ? { ...c, image: undefined } : c
      )
    );

    setImages((prev) => {
      const updated = prev.filter((_, i) => i !== index);

      if (image === removedUrl) {
        setImage(updated[0] ?? "");
      }

      return updated;
    });
  };

  const applyScannedBarcode = (value: string) => {
    const nextBarcode = value.trim();
    if (!nextBarcode) return;

    const target = barcodeScanTargetRef.current;

    if (target === "primary") {
      setBarcode(nextBarcode);
      return;
    }

    setAdditionalBarcodes((prev) =>
      prev.map((item, index) =>
        index === target
          ? { ...item, barcode: nextBarcode }
          : item
      )
    );
  };

  useEffect(() => {
    if (Platform.OS === "web" || !CameraView.isModernBarcodeScannerAvailable) return;

    const subscription = CameraView.onModernBarcodeScanned(({ data }) => {
      if (!data?.trim()) return;

      applyScannedBarcode(data);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
    });

    return () => subscription.remove();
  }, [barcodeBeep]);

  const handleOpenBarcodeScanner = async (
    target: "primary" | number = "primary",
  ) => {
    barcodeScanTargetRef.current = target;
    if (Platform.OS === "web") {
      setBarcodeScanned(false);
      setScannerOpen(true);
      return;
    }

    if (CameraView.isModernBarcodeScannerAvailable) {
      try {
        await CameraView.launchScanner({
          barcodeTypes: [
            "ean13", "ean8", "upc_a", "upc_e",
            "code128", "code39", "code93",
            "itf14", "codabar", "qr",
          ],
        });
      } catch {
        setErrors(["تعذر فتح ماسح الباركود"]);
      }
      return;
    }

    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

    if (!permission.granted) {
      setErrors(["يجب السماح باستخدام الكاميرا لمسح الباركود"]);
      return;
    }

    setBarcodeScanned(false);
    setScannerOpen(true);
  };

  const handleBarcodeScanned = (data: string) => {
    if (barcodeScanned) return;

    setBarcodeScanned(true);
    applyScannedBarcode(data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
    setScannerOpen(false);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !scannerOpen) return;

    let disposed = false;
    let controls: { stop: () => void } | undefined;

    const timer = setTimeout(() => {
      void startWebBarcodeScanner(
        "add-product-barcode-video",
        (value) => {
          if (disposed) return;

          disposed = true;
          setBarcodeScanned(true);
          applyScannedBarcode(value);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void barcodeBeep.seekTo(0).then(() => barcodeBeep.play()).catch(() => {});
          setScannerOpen(false);
        }
      )
        .then((scannerControls) => {
          if (disposed) scannerControls.stop();
          else controls = scannerControls;
        })
        .catch(() => {
          if (!disposed) {
            setScannerOpen(false);
            setErrors(["تعذر تشغيل كاميرا مسح الباركود"]);
          }
        });
    }, 100);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, [scannerOpen, barcodeBeep]);

  const addSocialLink = () => {
    const raw = socialUrlInput.trim();
    if (!raw) return;

    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    let hostname = "";
    try {
      hostname = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      setErrors(["الرابط غير صحيح"]);
      return;
    }

    if (
      hostname === "facebook.com" ||
      hostname.endsWith(".facebook.com") ||
      hostname === "fb.com" ||
      hostname.endsWith(".fb.com")
    ) {
      setFacebookUrl(normalized);
    } else if (
      hostname === "instagram.com" ||
      hostname.endsWith(".instagram.com") ||
      hostname === "instagr.am"
    ) {
      setInstagramUrl(normalized);
    } else if (
      hostname === "tiktok.com" ||
      hostname.endsWith(".tiktok.com")
    ) {
      setTiktokUrl(normalized);
    } else {
      setErrors(["الرابط غير مدعوم. استخدم Facebook أو Instagram أو TikTok"]);
      return;
    }

    setSocialUrlInput("");
    setErrors([]);
  };

  const validate = () => {
    const errs: string[] = [];
    if (!nameAr.trim()) errs.push("اسم المنتج بالعربي مطلوب");
    if (!price.trim() || isNaN(Number(price))) errs.push("السعر يجب أن يكون رقماً صحيحاً");
    if (!image.trim()) errs.push("صورة المنتج مطلوبة");
    if (stock.trim() && isNaN(Number(stock))) errs.push("الكمية يجب أن تكون رقماً صحيحاً");
    if (isNew && (!newDays.trim() || !Number.isInteger(Number(newDays)) || Number(newDays) <= 0)) errs.push("مدة وصل حديثًا يجب أن تكون عدد أيام صحيحًا أكبر من صفر");

    const extraBarcodeValues = additionalBarcodes.map((item) =>
      item.barcode.trim()
    );

    if (extraBarcodeValues.some((value) => !value)) {
      errs.push("أدخل الباركود الإضافي أو احذف الحقل الفارغ");
    }

    const allBarcodeValues = [
      barcode.trim(),
      ...extraBarcodeValues,
    ].filter(Boolean);

    if (new Set(allBarcodeValues).size !== allBarcodeValues.length) {
      errs.push("يوجد باركود مكرر داخل نفس المنتج");
    }

    setErrors(errs);
    return errs.length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const newUntil = !isNew ? null : (isEdit && !newDurationChanged ? editProduct?.newUntil ?? null : new Date(Date.now() + Number(newDays) * 86400000).toISOString());
      const productData: Omit<Product, "id"> = {
        nameAr: nameAr.trim(),
        name: name.trim() || nameAr.trim(),
        productCode: productCode.trim() || null,
        barcode: barcode.trim() || null,
        additionalBarcodes,
        price: Number(price),
        originalPrice: originalPrice.trim() ? Number(originalPrice) : undefined,
        image: image.trim(),
        images: images.length > 0 ? images : [image.trim()],
        description: description.trim() || nameAr.trim(),
        category,
        ageGroup,
        gender,
        season,
        isPinned,
        showInOffers,
        facebookUrl: facebookUrl.trim() || null,
        instagramUrl: instagramUrl.trim() || null,
        tiktokUrl: tiktokUrl.trim() || null,
        sizes,
        colorVariants,
        rating: editProduct?.rating ?? 4.8,
        reviews: editProduct?.reviews ?? 0,
        isNew,
        newUntil,
        stock: stock.trim() ? Number(stock) : null,
      };

      if (isEdit && editProduct) {
        await updateProduct({ ...productData, id: editProduct.id });
      } else {
        await addProduct(productData);
      }
      router.back();
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : "فشل الحفظ، يرجى المحاولة مجدداً",
      ]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, backgroundColor: colors.primary }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>{isEdit ? "تعديل المنتج" : "إضافة منتج جديد"}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.form}>
        {/* Errors */}
        {errors.length > 0 && (
          <View style={[styles.errorBox, { backgroundColor: "#fee2e2", borderColor: colors.destructive }]}>
            {errors.map((e) => (
              <Text key={e} style={[styles.errorText, { color: colors.destructive }]}>• {e}</Text>
            ))}
          </View>
        )}

        {/* Name Arabic */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>اسم المنتج بالعربي *</Text>
          <TextInput
            value={nameAr}
            onChangeText={setNameAr}
            placeholder="مثال: فستان بنات ملون"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </View>

        {/* Name English */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>اسم المنتج بالإنجليزي (اختياري)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Colorful Girls Dress"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>

        {/* Product Code */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>كود المنتج (اختياري)</Text>
          <TextInput
            value={productCode}
            onChangeText={setProductCode}
            placeholder="مثال: LK-1001"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
        </View>

        {/* Barcode */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الباركود (اختياري)</Text>
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            placeholder="امسح أو اكتب رقم الباركود"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
          />
          <Pressable
            onPress={() => void handleOpenBarcodeScanner("primary")}
            style={{
              flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 11,
              borderRadius: 12,
              backgroundColor: colors.primary,
            }}
          >
            <Ionicons name="camera-outline" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700" }}>مسح الباركود بالكاميرا</Text>
          </Pressable>
        </View>

        {/* Additional Barcodes */}
        <View style={styles.field}>
          <Pressable
            onPress={() =>
              setAdditionalBarcodesExpanded(
                (current) => !current,
              )
            }
            style={{
              flexDirection:
                Platform.OS === "web"
                  ? "row-reverse"
                  : "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 14,
              paddingVertical: 13,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <View
              style={{
                flexDirection:
                  Platform.OS === "web"
                    ? "row-reverse"
                    : "row",
                alignItems: "center",
                gap: 7,
              }}
            >
              <Ionicons
                name="barcode-outline"
                size={20}
                color={colors.primary}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontWeight: "800",
                }}
              >
                الباركودات الإضافية و QR ({additionalBarcodes.length})
              </Text>
            </View>

            <Ionicons
              name={
                additionalBarcodesExpanded
                  ? "chevron-up"
                  : "chevron-down"
              }
              size={20}
              color={colors.primary}
            />
          </Pressable>

          {additionalBarcodesExpanded ? (
            <>
          <Pressable
            onPress={() => {
              addAdditionalBarcode();
              setAdditionalBarcodesExpanded(true);
            }}
            style={{
              flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 11,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.primary + "10",
            }}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: "700" }}>
              إضافة باركود إضافي
            </Text>
          </Pressable>

          {additionalBarcodes.map((item, index) => (
            <View
              key={index}
              style={{
                gap: 8,
                padding: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                backgroundColor: colors.card,
              }}
            >
              <Text style={[styles.label, { color: colors.foreground }]}>
                باركود إضافي {index + 1}
              </Text>

              <TextInput
                value={item.barcode}
                onChangeText={(value) =>
                  updateAdditionalBarcode(index, { barcode: value })
                }
                placeholder="امسح أو اكتب رقم الباركود"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                textAlign="right"
              />

              {colorVariants.length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    اللون (اختياري)
                  </Text>

                  <View style={styles.sizesWrap}>
                    <Pressable
                      onPress={() =>
                        updateAdditionalBarcode(index, {
                          color: null,
                          size: null,
                        })
                      }
                      style={[
                        styles.sizeChip,
                        {
                          borderColor: !item.color
                            ? colors.primary
                            : colors.border,
                          backgroundColor: !item.color
                            ? colors.primary + "20"
                            : colors.background,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: !item.color
                            ? colors.primary
                            : colors.foreground,
                        }}
                      >
                        بدون تحديد
                      </Text>
                    </Pressable>

                    {colorVariants.map((variant) => (
                      <Pressable
                        key={variant.color}
                        onPress={() =>
                          updateAdditionalBarcode(index, {
                            color: variant.color,
                            size: null,
                          })
                        }
                        style={[
                          styles.sizeChip,
                          {
                            borderColor:
                              item.color === variant.color
                                ? colors.primary
                                : colors.border,
                            backgroundColor:
                              item.color === variant.color
                                ? colors.primary + "20"
                                : colors.background,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.swatch,
                            {
                              width: 14,
                              height: 14,
                              backgroundColor: variant.hex,
                              borderColor: colors.border,
                            },
                          ]}
                        />
                        <Text
                          style={{
                            color:
                              item.color === variant.color
                                ? colors.primary
                                : colors.foreground,
                          }}
                        >
                          {variant.color}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {getAdditionalBarcodeSizeOptions(item).length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    المقاس (اختياري)
                  </Text>

                  <View style={styles.sizesWrap}>
                    <Pressable
                      onPress={() =>
                        updateAdditionalBarcode(index, { size: null })
                      }
                      style={[
                        styles.sizeChip,
                        {
                          borderColor: !item.size
                            ? colors.primary
                            : colors.border,
                          backgroundColor: !item.size
                            ? colors.primary + "20"
                            : colors.background,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: !item.size
                            ? colors.primary
                            : colors.foreground,
                        }}
                      >
                        بدون تحديد
                      </Text>
                    </Pressable>

                    {getAdditionalBarcodeSizeOptions(item).map((sizeOption) => (
                      <Pressable
                        key={sizeOption}
                        onPress={() =>
                          updateAdditionalBarcode(index, {
                            size: sizeOption,
                          })
                        }
                        style={[
                          styles.sizeChip,
                          {
                            borderColor:
                              item.size === sizeOption
                                ? colors.primary
                                : colors.border,
                            backgroundColor:
                              item.size === sizeOption
                                ? colors.primary + "20"
                                : colors.background,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color:
                              item.size === sizeOption
                                ? colors.primary
                                : colors.foreground,
                          }}
                        >
                          {sizeOption}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <View style={{ flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 8 }}>
                <Pressable
                  onPress={() => void handleOpenBarcodeScanner(index)}
                  style={{
                    flex: 1,
                    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: colors.primary,
                  }}
                >
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700" }}>
                    مسح بالكاميرا
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => removeAdditionalBarcode(index)}
                  style={{
                    width: 46,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    backgroundColor: "#fee2e2",
                  }}
                >
                  <Ionicons name="trash-outline" size={19} color="#ef4444" />
                </Pressable>
              </View>
            </View>
          ))}
            </>
          ) : null}
        </View>

        {/* Price Row */}
        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={[styles.label, { color: colors.foreground }]}>السعر (₪) *</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="85"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={[styles.label, { color: colors.foreground }]}>السعر الأصلي (₪)</Text>
            <TextInput
              value={originalPrice}
              onChangeText={setOriginalPrice}
              placeholder="120 (اختياري)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              textAlign="right"
            />
          </View>
        </View>

        {/* Product Offers */}
        <View
          style={{
            flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            marginBottom: 4,
          }}
        >
          <View style={{ flex: 1, alignItems: "flex-end", marginLeft: 12 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              🔥 إضافة إلى العروض
            </Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              يظهر المنتج تلقائيًا ضمن قسم العروض
            </Text>
          </View>
          <Switch
            value={showInOffers}
            onValueChange={setShowInOffers}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Product Social Links */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            روابط المنتج على السوشال (اختياري)
          </Text>
          <Text style={[styles.hint, { color: colors.mutedForeground, marginBottom: 6 }]}>
            الصق رابط Facebook أو Instagram أو TikTok وسيتم التعرف عليه تلقائيًا
          </Text>

          <View style={{ flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 8 }}>
            <TextInput
              value={socialUrlInput}
              onChangeText={setSocialUrlInput}
              placeholder="الصق الرابط هنا..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.input,
                {
                  flex: 1,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              textAlign="left"
            />
            <Pressable
              onPress={addSocialLink}
              style={{
                minWidth: 72,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.primary,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>إضافة</Text>
            </Pressable>
          </View>

          {(facebookUrl || instagramUrl || tiktokUrl) ? (
            <View
              style={{
                flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 10,
              }}
            >
              {facebookUrl ? (
                <Pressable
                  onPress={() => setFacebookUrl("")}
                  style={{
                    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-facebook" size={18} color="#1877F2" />
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>Facebook</Text>
                  <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}

              {instagramUrl ? (
                <Pressable
                  onPress={() => setInstagramUrl("")}
                  style={{
                    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-instagram" size={18} color="#E1306C" />
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>Instagram</Text>
                  <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}

              {tiktokUrl ? (
                <Pressable
                  onPress={() => setTiktokUrl("")}
                  style={{
                    flexDirection: Platform.OS === "web" ? "row-reverse" : "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="logo-tiktok" size={18} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>TikTok</Text>
                  <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Stock */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الكمية المتوفرة</Text>
          <View style={[styles.stockRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="cube-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              value={stock}
              onChangeText={setStock}
              placeholder="اتركه فارغاً إن لم يكن هناك حد للكمية"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              style={[styles.stockInput, { color: colors.foreground }]}
              textAlign="right"
            />
          </View>
        </View>

        {/* Image Upload — Multi */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>صور المنتج *</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground, marginBottom: 4 }]}>
            اختر الصورة الرئيسية بالضغط على ⭐ — يمكنك إضافة حتى 8 صور
          </Text>

          {/* Image Grid */}
          {images.length > 0 && (
            <View style={styles.imageGrid}>
              {images.map((img, idx) => (
                <View key={idx} style={[styles.gridItem, { borderColor: image === img ? colors.primary : colors.border }]}>
                  {image === img && (
                    <View style={[styles.mainBadge, { backgroundColor: colors.primary }]}>
                      <Text style={styles.mainBadgeText}>رئيسية</Text>
                    </View>
                  )}
                  <Image source={{ uri: img }} style={styles.gridImage} resizeMode="contain" />
                  <View style={styles.gridActions}>
                    <Pressable
                      onPress={() => setImage(img)}
                      disabled={image === img}
                      accessibilityLabel={
                        image === img
                          ? "الصورة الرئيسية"
                          : "اجعلها الصورة الرئيسية"
                      }
                      style={[
                        styles.gridBtn,
                        {
                          backgroundColor:
                            image === img
                              ? colors.primary + "25"
                              : colors.primary + "10",
                        },
                      ]}
                    >
                      <Ionicons
                        name={image === img ? "star" : "star-outline"}
                        size={15}
                        color={colors.primary}
                      />
                    </Pressable>

                    <Pressable
                      onPress={() => handleReplaceImage(idx)}
                      disabled={uploading}
                      style={[styles.gridBtn, { backgroundColor: colors.primary + "20" }]}
                    >
                      <Ionicons name="camera-outline" size={14} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveImage(idx)}
                      style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* Add more button */}
              {images.length < 8 && (
                <Pressable
                  onPress={handleAddImage}
                  disabled={uploading}
                  style={[styles.gridAddBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
                      <Text style={[styles.gridAddText, { color: colors.primary }]}>إضافة</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {/* First upload CTA when empty */}
          {images.length === 0 && (
            <Pressable
              onPress={handleAddImage}
              disabled={uploading}
              style={[styles.uploadBox, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
            >
              {uploading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={40} color={colors.primary} />
              )}
              <Text style={[styles.uploadText, { color: colors.primary }]}>
                {uploading ? "جارٍ رفع الصورة..." : "اضغط لاختيار صورة من جهازك"}
              </Text>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>
                يمكنك إضافة حتى 8 صور للمنتج
              </Text>
            </Pressable>
          )}

          {/* Manual URL fallback */}
          <View style={[styles.urlRow, { borderColor: colors.border }]}>
            <Ionicons name="link-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.urlLabel, { color: colors.mutedForeground }]}>أو أدخل رابط الصورة الرئيسية يدوياً</Text>
          </View>
          <TextInput
            value={image}
            onChangeText={(v) => {
              const previousUrl = image;
              setImage(v);

              if (!v) return;

              setImages((prev) => {
                if (prev.length === 0) return [v];

                const updated = [...prev];
                const mainIndex = previousUrl
                  ? updated.indexOf(previousUrl)
                  : -1;

                if (mainIndex >= 0) {
                  updated[mainIndex] = v;
                } else if (!updated.includes(v)) {
                  updated.unshift(v);

                  if (updated.length > 8) {
                    updated.pop();
                  }
                }

                return [...new Set(updated)];
              });

              if (previousUrl && previousUrl !== v) {
                setColorVariants((prev) =>
                  prev.map((c) =>
                    c.image === previousUrl ? { ...c, image: v } : c
                  )
                );
              }
            }}
            placeholder="https://..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>وصف المنتج</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="وصف مختصر للمنتج..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[styles.input, styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            textAlign="right"
            textAlignVertical="top"
          />
        </View>

        {/* Sizes */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>المقاسات</Text>
          <View style={[styles.sizeInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={addSize} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={18} color="#fff" />
            </Pressable>
            <TextInput
              value={sizeInput}
              onChangeText={setSizeInput}
              onSubmitEditing={addSize}
              placeholder="مثال: S, M, L, XL, 0-3M"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.sizeTextInput, { color: colors.foreground }]}
              textAlign="right"
              returnKeyType="done"
            />
          </View>
          {sizes.length > 0 && (
            <View style={styles.sizesWrap}>
              {sizes.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => removeSize(s)}
                  style={[styles.sizeChip, { backgroundColor: colors.primary + "20", borderColor: colors.primary }]}
                >
                  <Ionicons name="close" size={12} color={colors.primary} />
                  <Text style={[styles.sizeChipText, { color: colors.primary }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            اكتب المقاس ثم اضغط + أو Enter — اضغط على المقاس لحذفه
          </Text>
        </View>

        {/* Colors & Sizes per color */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الألوان والمقاسات (اختياري)</Text>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            أضيفي لوناً ثم مقاساته — اضغطي على المقاس لتعليمه "نفد المخزون" (يظهر بعلامة X للزبون)
          </Text>

          {/* Custom color picker for new color */}
          <ColorPickerButton value={newColorHex} title="لون هذا الخيار" onChange={setNewColorHex} />
          <View style={{ height: 10 }} />

          <View style={[styles.sizeInputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={addColorVariant} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={18} color="#fff" />
            </Pressable>
            <TextInput
              value={newColorName}
              onChangeText={setNewColorName}
              onSubmitEditing={addColorVariant}
              placeholder="اسم اللون، مثال: أحمر"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.sizeTextInput, { color: colors.foreground }]}
              textAlign="right"
              returnKeyType="done"
            />
          </View>

          {colorVariants.length > 0 && (
            <View style={{ gap: 12, marginTop: 8 }}>
              {colorVariants.map((cv, idx) => (
                <View key={`${cv.color}-${idx}`} style={[styles.colorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.colorCardHeader}>
                    <Pressable onPress={() => removeColorVariant(idx)} style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}>
                      <Ionicons name="trash-outline" size={14} color="#ef4444" />
                    </Pressable>
                    <View style={styles.colorCardTitle}>
                      <Text style={[styles.colorCardName, { color: colors.foreground }]}>{cv.color}</Text>
                      <View style={[styles.swatch, { backgroundColor: cv.hex, borderColor: colors.border, width: 20, height: 20 }]} />
                    </View>
                  </View>

                  <View style={styles.colorImageRow}>
                    {cv.image ? (
                      <View style={[styles.colorImageWrap, { borderColor: colors.border }]}>
                        <Image source={{ uri: cv.image }} style={styles.colorImageThumb} resizeMode="contain" />
                        <View style={styles.colorImageActions}>
                          <Pressable
                            onPress={() => handlePickColorImage(idx)}
                            disabled={uploading}
                            style={[styles.gridBtn, { backgroundColor: colors.primary + "20" }]}
                          >
                            <Ionicons name="camera-outline" size={14} color={colors.primary} />
                          </Pressable>
                          <Pressable
                            onPress={() => removeColorImage(idx)}
                            style={[styles.gridBtn, { backgroundColor: "#fee2e2" }]}
                          >
                            <Ionicons name="trash-outline" size={14} color="#ef4444" />
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handlePickColorImage(idx)}
                        disabled={uploading}
                        style={[styles.colorImageAddBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "08" }]}
                      >
                        {uploading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Ionicons name="image-outline" size={16} color={colors.primary} />
                            <Text style={[styles.colorImageAddText, { color: colors.primary }]}>صورة لهذا اللون (اختياري)</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>

                  <View style={[styles.sizeInputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Pressable onPress={() => addSizeToColor(idx)} style={[styles.addSizeBtn, { backgroundColor: colors.primary }]}>
                      <Ionicons name="add" size={16} color="#fff" />
                    </Pressable>
                    <TextInput
                      value={colorSizeQtyInputs[idx] ?? ""}
                      onChangeText={(v) => setColorSizeQtyInputs((prev) => ({ ...prev, [idx]: v }))}
                      onSubmitEditing={() => addSizeToColor(idx)}
                      placeholder="الكمية"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      style={[styles.sizeTextInput, { color: colors.foreground, fontSize: 13, maxWidth: 70 }]}
                      textAlign="right"
                      returnKeyType="done"
                    />
                    <TextInput
                      value={colorSizeInputs[idx] ?? ""}
                      onChangeText={(v) => setColorSizeInputs((prev) => ({ ...prev, [idx]: v }))}
                      onSubmitEditing={() => addSizeToColor(idx)}
                      placeholder="مقاس لهذا اللون، مثال: M"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.sizeTextInput, { color: colors.foreground, fontSize: 13 }]}
                      textAlign="right"
                      returnKeyType="done"
                    />
                  </View>

                  {cv.sizes.length > 0 && (
                    <View style={styles.colorSizesList}>
                      {cv.sizes.map((s) => {
                        const out = isSizeOutOfStock(s);
                        return (
                          <View
                            key={s.size}
                            style={[
                              styles.colorSizeRow,
                              { backgroundColor: out ? "#fee2e2" : colors.primary + "12", borderColor: out ? "#ef4444" : colors.primary + "40" },
                            ]}
                          >
                            <Pressable onPress={() => removeSizeFromColor(idx, s.size)}>
                              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                            </Pressable>
                            <TextInput
                              value={s.stock === null || s.stock === undefined ? "" : String(s.stock)}
                              onChangeText={(v) => updateSizeStock(idx, s.size, v)}
                              placeholder="غير محدود"
                              placeholderTextColor={colors.mutedForeground}
                              keyboardType="numeric"
                              style={[styles.colorSizeStockInput, { color: out ? "#ef4444" : colors.foreground }]}
                              textAlign="center"
                            />
                            <Text style={[styles.hint, { color: colors.mutedForeground, marginBottom: 0 }]}>قطعة</Text>
                            <Text style={[styles.sizeChipText, { color: out ? "#ef4444" : colors.primary, marginRight: "auto" }]}>
                              {s.size}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    اكتبي عدد القطع المتوفرة من كل مقاس — اتركيه فارغاً لكمية غير محدودة، أو 0 لنفاد المخزون
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Gender */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>تصنيف المنتج</Text>
          <View style={[styles.genderRow, { borderColor: colors.border }]}>
            {[
              { value: null,    label: "للجميع", emoji: "🛍️" },
              { value: "boys",  label: "ولادي",  emoji: "👦" },
              { value: "girls", label: "بناتي",  emoji: "👧" },
            ].map((opt) => (
              <Pressable
                key={String(opt.value)}
                onPress={() => setGender(opt.value as typeof gender)}
                style={[
                  styles.genderOption,
                  gender === opt.value && {
                    backgroundColor:
                      opt.value === "boys" ? "#3B82F6" :
                      opt.value === "girls" ? "#EC4899" :
                      colors.primary,
                  },
                ]}
              >
                <Text style={{ fontSize: 20 }}>{opt.emoji}</Text>
                <Text style={[styles.genderOptionText, { color: gender === opt.value ? "#fff" : colors.foreground }]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Category */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الفئة</Text>
          <View style={styles.chipsWrap}>
            {categories.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => setCategory(cat.id)}
                style={[styles.chip, { backgroundColor: category === cat.id ? colors.primary : colors.card, borderColor: category === cat.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: category === cat.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Age Group */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الفئة العمرية</Text>
          <View style={styles.chipsWrap}>
            {ageGroups.map((ag) => (
              <Pressable
                key={ag.id}
                onPress={() => setAgeGroup(ag.id)}
                style={[styles.chip, { backgroundColor: ageGroup === ag.id ? colors.primary : colors.card, borderColor: ageGroup === ag.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: ageGroup === ag.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {ag.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Season */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>الموسم</Text>
          <View style={styles.chipsWrap}>
            <Pressable
              onPress={() => setSeason(null)}
              style={[styles.chip, { backgroundColor: season === null ? colors.primary : colors.card, borderColor: season === null ? colors.primary : colors.border }]}
            >
              <Text style={{ color: season === null ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                بدون تحديد
              </Text>
            </Pressable>
            {seasons.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setSeason(s.id)}
                style={[styles.chip, { backgroundColor: season === s.id ? colors.primary : colors.card, borderColor: season === s.id ? colors.primary : colors.border }]}
              >
                <Text style={{ color: season === s.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Pin Product Toggle */}
        <Pressable
          onPress={() => setIsPinned((v) => !v)}
          style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.toggle, { backgroundColor: isPinned ? colors.primary : colors.muted }]}>
            {isPinned && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>📌 تثبيت في الأعلى</Text>
        </Pressable>

        {/* Is New Toggle */}
        <Pressable
          onPress={() => { setIsNew((v) => !v); setNewDurationChanged(true); }}
          style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.toggle, { backgroundColor: isNew ? colors.primary : colors.muted }]}>
            {isNew && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>منتج جديد (يظهر في "وصل حديثًا")</Text>
        </Pressable>

        {isNew && <Pressable onPress={() => { setNewDaysMode("7"); setNewDays("7"); setNewDurationChanged(true); }} style={[styles.chip,{backgroundColor:newDaysMode==="7"?colors.primary:colors.card,borderColor:newDaysMode==="7"?colors.primary:colors.border}]}><Text style={{color:newDaysMode==="7"?"#fff":colors.foreground}}>7 أيام</Text></Pressable>}
        {isNew && <Pressable onPress={() => { setNewDaysMode("14"); setNewDays("14"); setNewDurationChanged(true); }} style={[styles.chip,{backgroundColor:newDaysMode==="14"?colors.primary:colors.card,borderColor:newDaysMode==="14"?colors.primary:colors.border}]}><Text style={{color:newDaysMode==="14"?"#fff":colors.foreground}}>14 يوم</Text></Pressable>}
        {isNew && <Pressable onPress={() => { setNewDaysMode("custom"); setNewDays(""); setNewDurationChanged(true); }} style={[styles.chip,{backgroundColor:newDaysMode==="custom"?colors.primary:colors.card,borderColor:newDaysMode==="custom"?colors.primary:colors.border}]}><Text style={{color:newDaysMode==="custom"?"#fff":colors.foreground}}>مخصص</Text></Pressable>}
        {isNew && newDaysMode === "custom" && <TextInput value={newDays} onChangeText={(value) => { setNewDays(value); setNewDurationChanged(true); }} placeholder="عدد الأيام" keyboardType="number-pad" style={[styles.input, { borderColor: colors.border, color: colors.foreground }]} />}
        {isEdit && (
          <View style={{ gap: 8 }}>
            <Pressable
              onPress={() => {
                setQrGenerationMessage("");
                setQrGenerateOpen(true);
              }}
              disabled={saving || uploading}
              style={{
                minHeight: 52,
                borderRadius: 14,
                backgroundColor: "#111827",
                alignItems: "center",
                justifyContent: "center",
                flexDirection:
                  Platform.OS === "web"
                    ? "row-reverse"
                    : "row",
                gap: 10,
                paddingHorizontal: 16,
              }}
            >
              <Ionicons
                name="qr-code-outline"
                size={23}
                color="#fff"
              />

              <Text
                style={{
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: "800",
                }}
              >
                توليد QR للموديل
              </Text>
            </Pressable>

            {!!qrGenerationMessage && (
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {qrGenerationMessage}
              </Text>
            )}
          </View>
        )}

        {isEdit && (
          <Pressable
            onPress={openQrPrintOptions}
            disabled={
              saving ||
              uploading ||
              printingQrs
            }
            style={{
              minHeight: 52,
              borderRadius: 14,

              backgroundColor: "#0f766e",

              alignItems: "center",
              justifyContent: "center",

              flexDirection:
                Platform.OS === "web"
                  ? "row-reverse"
                  : "row",

              gap: 10,

              paddingHorizontal: 16,

              opacity:
                printingQrs
                  ? 0.7
                  : 1,
            }}
          >

            <Ionicons
              name="print-outline"
              size={22}
              color="#fff"
            />

            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                fontWeight: "800",
              }}
            >

              {
                printingQrs
                  ? "جارٍ تجهيز المعاينة..."
                  : "طباعة QR مباشرة"
              }

            </Text>

          </Pressable>
        )}

        {/* Save Button */}
        <Pressable
          onPress={handleSave}
          disabled={saving || uploading}
          style={[styles.saveBtn, { backgroundColor: (saving || uploading) ? colors.mutedForeground : colors.primary }]}
        >
          <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
          <Text style={styles.saveBtnText}>
            {saving ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة المنتج"}
          </Text>
        </Pressable>
      </View>
      <Modal
        visible={qrPrintOpen}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setQrPrintOpen(false)
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor:
              "rgba(0,0,0,0.58)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "96%",
              maxWidth: 560,
              maxHeight: "92%",
              borderRadius: 20,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor:
                  colors.border,
                gap: 5,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 19,
                  fontWeight: "900",
                  textAlign: "center",
                }}
              >
                اختيار ملصقات QR
              </Text>

              <Text
                style={{
                  color:
                    colors.mutedForeground,
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                اختر الألوان والنمر وحدد عدد النسخ
              </Text>
            </View>

            <View
              style={{
                flexDirection:
                  Platform.OS === "web"
                    ? "row-reverse"
                    : "row",
                flexWrap: "wrap",
                gap: 7,
                padding: 12,
                borderBottomWidth: 1,
                borderBottomColor:
                  colors.border,
              }}
            >
              <Pressable
                onPress={() =>
                  selectAllQrPrintRows(true)
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor:
                    colors.primary,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  تحديد الكل
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  selectAllQrPrintRows(false)
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor:
                    colors.muted,
                }}
              >
                <Text
                  style={{
                    color:
                      colors.foreground,
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  إلغاء التحديد
                </Text>
              </Pressable>

              <Pressable
                onPress={
                  applyQrCopiesFromStock
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor:
                    "#0f766e",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  العدد حسب المخزون
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={{
                maxHeight:
                  Platform.OS === "web"
                    ? 430
                    : 440,
              }}
              contentContainerStyle={{
                padding: 12,
                gap: 8,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {getGeneratedQrBarcodes().map(
                (item) => {
                  const selected =
                    !!qrPrintSelected[
                      item.barcode
                    ];

                  const stockQty =
                    getQrStockQuantity(item);

                  return (
                    <View
                      key={item.barcode}
                      style={{
                        flexDirection:
                          Platform.OS ===
                          "web"
                            ? "row-reverse"
                            : "row",
                        alignItems:
                          "center",
                        gap: 10,
                        padding: 11,
                        borderWidth: 1,
                        borderColor:
                          selected
                            ? colors.primary
                            : colors.border,
                        borderRadius: 13,
                        opacity:
                          selected
                            ? 1
                            : 0.55,
                        backgroundColor:
                          colors.background,
                      }}
                    >
                      <Pressable
                        onPress={() => {
                          if (stockQty === 0) return;

                          setQrPrintSelected(
                            (previous) => ({
                              ...previous,
                              [item.barcode]:
                                !selected,
                            }),
                          );
                        }}
                        style={{
                          width: 25,
                          height: 25,
                          borderRadius: 7,
                          borderWidth: 2,
                          borderColor:
                            selected
                              ? colors.primary
                              : colors.border,
                          backgroundColor:
                            selected
                              ? colors.primary
                              : "transparent",
                          alignItems:
                            "center",
                          justifyContent:
                            "center",
                        }}
                      >
                        {selected && (
                          <Ionicons
                            name="checkmark"
                            size={17}
                            color="#fff"
                          />
                        )}
                      </Pressable>

                      <View
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              colors.foreground,
                            fontSize: 14,
                            fontWeight: "800",
                          }}
                        >
                          {item.color ||
                            "بدون لون"}
                          {"  •  "}
                          نمرة{" "}
                          {item.size ||
                            "—"}
                        </Text>

                        <Text
                          numberOfLines={1}
                          style={{
                            color:
                              colors.mutedForeground,
                            fontSize: 10,
                            marginTop: 3,
                          }}
                        >
                          {stockQty === null
                            ? "المخزون غير محدد لهذه النمرة"
                            : stockQty === 0
                              ? "نفد من المخزون — لن يُطبع"
                              : `المخزون: ${stockQty}`}
                        </Text>
                      </View>

                      <View
                        style={{
                          alignItems:
                            "center",
                          gap: 3,
                        }}
                      >
                        <Text
                          style={{
                            color:
                              colors.mutedForeground,
                            fontSize: 10,
                            fontWeight: "700",
                          }}
                        >
                          النسخ
                        </Text>

                        <TextInput
                          editable={stockQty !== 0}
                          value={
                            stockQty === 0
                              ? "0"
                              : qrPrintCopies[
                                  item.barcode
                                ] ?? "1"
                          }
                          onChangeText={(
                            value,
                          ) =>
                            setQrPrintCopies(
                              (previous) => ({
                                ...previous,
                                [item.barcode]:
                                  value.replace(
                                    /[^0-9]/g,
                                    "",
                                  ),
                              }),
                            )
                          }
                          keyboardType="number-pad"
                          selectTextOnFocus
                          style={{
                            width: 58,
                            height: 38,
                            borderRadius: 9,
                            borderWidth: 1,
                            borderColor:
                              colors.border,
                            backgroundColor:
                              colors.card,
                            color:
                              colors.foreground,
                            textAlign:
                              "center",
                            fontSize: 15,
                            fontWeight: "900",
                            paddingHorizontal: 5,
                          }}
                        />
                      </View>
                    </View>
                  );
                },
              )}
            </ScrollView>

            
            <View
              style={{
                padding: 12,
                borderTopWidth: 1,
                borderTopColor:
                  colors.border,
                flexDirection:
                  Platform.OS === "web"
                    ? "row-reverse"
                    : "row",
                gap: 8,
              }}
            >
              <Pressable
                onPress={() =>
                  handleQrLabelPreview()
                }
                disabled={printingQrs}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  backgroundColor:
                    "#0f766e",
                  alignItems: "center",
                  justifyContent:
                    "center",
                  flexDirection:
                    Platform.OS === "web"
                      ? "row-reverse"
                      : "row",
                  gap: 8,
                  opacity:
                    printingQrs
                      ? 0.65
                      : 1,
                }}
              >
                <Ionicons
                  name="print-outline"
                  size={20}
                  color="#fff"
                />

                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "900",
                    fontSize: 14,
                  }}
                >
                  {printingQrs
                    ? "جارٍ التجهيز..."
                    : "معاينة الملصق"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  setQrPrintOpen(false)
                }
                style={{
                  minWidth: 90,
                  minHeight: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor:
                    colors.border,
                  alignItems: "center",
                  justifyContent:
                    "center",
                }}
              >
                <Text
                  style={{
                    color:
                      colors.foreground,
                    fontWeight: "800",
                  }}
                >
                  إلغاء
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={qrPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setQrPreviewOpen(false)
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor:
              "rgba(0,0,0,0.72)",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              width: "96%",
              maxWidth: 650,
              borderRadius: 20,
              backgroundColor:
                colors.card,
              borderWidth: 1,
              borderColor:
                colors.border,
              padding: 18,
              gap: 16,
            }}
          >
            <Text
              style={{
                color:
                  colors.foreground,
                fontSize: 20,
                fontWeight: "900",
                textAlign: "center",
              }}
            >
              معاينة ملصق QR
            </Text>

            <Text
              style={{
                color:
                  colors.mutedForeground,
                fontSize: 12,
                textAlign: "center",
              }}
            >
              المقاس الفعلي 50 × 25 مم
              — المعاينة من نفس تصميم الطباعة
            </Text>

            <View
              onLayout={(event) => {
                qrLabelPreviewSize.current = {
                  width:
                    event.nativeEvent.layout.width,
                  height:
                    event.nativeEvent.layout.height,
                };
              }}
              style={{
                width: "100%",
                aspectRatio:
                  384 / 195,
                backgroundColor:
                  "#ffffff",
                borderRadius: 14,
                borderWidth: 7,
                borderColor:
                  "#e5e7eb",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {qrPreviewUri ? (
                <Image
                  source={{
                    uri: qrPreviewUri,
                  }}
                  resizeMode="stretch"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: "100%",
                    height: "100%",
                    backgroundColor:
                      "#ffffff",
                  }}
                />
              ) : null}

              {(
                [
                  "qr",
                  "brand",
                  "name",
                  "code",
                  "color",
                  "variantSize",
                  "price",
                ] as QrLabelElementId[]
              ).map((elementId) => {
                const box =
                  getQrLabelEditorBox(
                    elementId,
                  );

                const selected =
                  qrLabelSelectedElement ===
                  elementId;

                const visible =
                  qrLabelLayout[
                    elementId
                  ].visible;

                if (!visible) {
                  return null;
                }

                return (
                  <View
                    key={elementId}
                    onStartShouldSetResponder={() =>
                      true
                    }
                    onMoveShouldSetResponder={() =>
                      true
                    }
                    onResponderGrant={(
                      event,
                    ) =>
                      beginQrLabelDrag(
                        elementId,
                        event,
                      )
                    }
                    onResponderMove={
                      moveQrLabelDrag
                    }
                    onResponderRelease={
                      endQrLabelDrag
                    }
                    onResponderTerminate={
                      endQrLabelDrag
                    }
                    style={{
                      position:
                        "absolute",
                      left:
                        `${box.left}%`,
                      top:
                        `${box.top}%`,
                      width:
                        `${box.width}%`,
                      height:
                        `${box.height}%`,
                      borderWidth:
                        selected ? 2 : 1,
                      borderColor:
                        selected
                          ? "#e91e8c"
                          : "rgba(15,118,110,0.28)",
                      backgroundColor:
                        selected
                          ? "rgba(233,30,140,0.05)"
                          : "transparent",
                    }}
                  />
                );
              })}
            </View>

            <View
              style={{
                gap: 9,
                padding: 10,
                borderWidth: 1,
                borderColor:
                  colors.border,
                borderRadius: 12,
                backgroundColor:
                  colors.background,
              }}
            >
              <Text
                style={{
                  color:
                    colors.foreground,
                  fontSize: 13,
                  fontWeight: "900",
                  textAlign: "center",
                }}
              >
                اختر العنصر ثم اسحبه بالماوس داخل الملصق
              </Text>

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  flexWrap: "wrap",
                  justifyContent:
                    "center",
                  gap: 5,
                }}
              >
                {(
                  [
                    "qr",
                    "brand",
                    "name",
                    "code",
                    "color",
                    "variantSize",
                    "price",
                  ] as QrLabelElementId[]
                ).map((elementId) => {
                  const active =
                    qrLabelSelectedElement ===
                    elementId;

                  return (
                    <Pressable
                      key={elementId}
                      onPress={() =>
                        setQrLabelSelectedElement(
                          elementId,
                        )
                      }
                      style={{
                        paddingHorizontal: 9,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor:
                          active
                            ? colors.primary
                            : colors.muted,
                      }}
                    >
                      <Text
                        style={{
                          color:
                            active
                              ? "#fff"
                              : colors.foreground,
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {
                          qrLabelElementNames[
                            elementId
                          ]
                        }
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  alignItems: "flex-end",
                  justifyContent:
                    "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    gap: 4,
                    alignItems:
                      "center",
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 11,
                      fontWeight: "800",
                    }}
                  >
                    X يمين / يسار
                  </Text>

                  <TextInput
                    key={`x-${qrLabelSelectedElement}`}
                    value={String(
                      qrLabelLayout[
                        qrLabelSelectedElement
                      ].x,
                    )}
                    onChangeText={(value) =>
                      setQrLabelNumericValue(
                        "x",
                        value,
                      )
                    }
                    selectTextOnFocus
                    style={{
                      width: 90,
                      height: 38,
                      borderWidth: 1,
                      borderColor:
                        colors.border,
                      borderRadius: 8,
                      backgroundColor:
                        colors.card,
                      color:
                        colors.foreground,
                      textAlign:
                        "center",
                      fontSize: 14,
                      fontWeight: "900",
                      paddingHorizontal: 6,
                    }}
                  />
                </View>

                <View
                  style={{
                    gap: 4,
                    alignItems:
                      "center",
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 11,
                      fontWeight: "800",
                    }}
                  >
                    Y فوق / تحت
                  </Text>

                  <TextInput
                    key={`y-${qrLabelSelectedElement}`}
                    value={String(
                      qrLabelLayout[
                        qrLabelSelectedElement
                      ].y,
                    )}
                    onChangeText={(value) =>
                      setQrLabelNumericValue(
                        "y",
                        value,
                      )
                    }
                    selectTextOnFocus
                    style={{
                      width: 90,
                      height: 38,
                      borderWidth: 1,
                      borderColor:
                        colors.border,
                      borderRadius: 8,
                      backgroundColor:
                        colors.card,
                      color:
                        colors.foreground,
                      textAlign:
                        "center",
                      fontSize: 14,
                      fontWeight: "900",
                      paddingHorizontal: 6,
                    }}
                  />
                </View>

                <View
                  style={{
                    gap: 4,
                    alignItems:
                      "center",
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 11,
                      fontWeight: "800",
                    }}
                  >
                    الحجم
                  </Text>

                  <TextInput
                    key={`size-${qrLabelSelectedElement}`}
                    value={String(
                      qrLabelLayout[
                        qrLabelSelectedElement
                      ].size,
                    )}
                    onChangeText={(value) =>
                      setQrLabelNumericValue(
                        "size",
                        value,
                      )
                    }
                    selectTextOnFocus
                    style={{
                      width: 90,
                      height: 38,
                      borderWidth: 1,
                      borderColor:
                        colors.border,
                      borderRadius: 8,
                      backgroundColor:
                        colors.card,
                      color:
                        colors.foreground,
                      textAlign:
                        "center",
                      fontSize: 14,
                      fontWeight: "900",
                      paddingHorizontal: 6,
                    }}
                  />
                </View>
              </View>

              {qrLabelSelectedElement !== "qr" && (
                <View
                  style={{
                    gap: 5,
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 11,
                      fontWeight: "800",
                      textAlign: "right",
                    }}
                  >
                    النص
                  </Text>

                  <TextInput
                    value={
                      qrLabelLayout[
                        qrLabelSelectedElement
                      ].text
                    }
                    onChangeText={(value) =>
                      updateQrLabelElement(
                        qrLabelSelectedElement,
                        {
                          text: value,
                        },
                      )
                    }
                    autoCorrect={false}
                    style={{
                      minHeight: 40,
                      borderWidth: 1,
                      borderColor:
                        colors.border,
                      borderRadius: 8,
                      backgroundColor:
                        colors.card,
                      color:
                        colors.foreground,
                      textAlign: "right",
                      fontSize: 14,
                      fontWeight: "700",
                      paddingHorizontal: 10,
                    }}
                  />

                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 9,
                      textAlign: "center",
                    }}
                  >
                    المتغيرات: {"{name}"} {"{code}"} {"{color}"} {"{size}"} {"{price}"}
                  </Text>
                </View>
              )}

              {qrLabelSelectedElement !== "qr" && (
                <View
                  style={{
                    flexDirection:
                      "row-reverse",
                    justifyContent:
                      "center",
                    alignItems:
                      "center",
                    flexWrap: "wrap",
                    gap: 7,
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.mutedForeground,
                      fontSize: 11,
                      fontWeight: "800",
                      marginLeft: 4,
                    }}
                  >
                    تنسيق النص
                  </Text>

                  <Pressable
                    onPress={() =>
                      toggleQrLabelTextStyle(
                        "bold",
                      )
                    }
                    style={{
                      width: 42,
                      height: 38,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].bold
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].bold
                          ? colors.primary
                          : colors.card,
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    <Text
                      style={{
                        color:
                          qrLabelLayout[
                            qrLabelSelectedElement
                          ].bold
                            ? "#fff"
                            : colors.foreground,
                        fontSize: 17,
                        fontWeight: "900",
                      }}
                    >
                      B
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      toggleQrLabelTextStyle(
                        "italic",
                      )
                    }
                    style={{
                      width: 42,
                      height: 38,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].italic
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].italic
                          ? colors.primary
                          : colors.card,
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    <Text
                      style={{
                        color:
                          qrLabelLayout[
                            qrLabelSelectedElement
                          ].italic
                            ? "#fff"
                            : colors.foreground,
                        fontSize: 17,
                        fontStyle: "italic",
                        fontWeight: "700",
                      }}
                    >
                      I
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      toggleQrLabelTextStyle(
                        "underline",
                      )
                    }
                    style={{
                      width: 42,
                      height: 38,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].underline
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].underline
                          ? colors.primary
                          : colors.card,
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    <Text
                      style={{
                        color:
                          qrLabelLayout[
                            qrLabelSelectedElement
                          ].underline
                            ? "#fff"
                            : colors.foreground,
                        fontSize: 17,
                        fontWeight: "700",
                        textDecorationLine:
                          "underline",
                      }}
                    >
                      U
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      toggleQrLabelTextStyle(
                        "inverted",
                      )
                    }
                    style={{
                      minWidth: 86,
                      height: 38,
                      paddingHorizontal: 9,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].inverted
                          ? "#000000"
                          : colors.border,
                      backgroundColor:
                        qrLabelLayout[
                          qrLabelSelectedElement
                        ].inverted
                          ? "#000000"
                          : colors.card,
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                    }}
                  >
                    <Text
                      style={{
                        color:
                          qrLabelLayout[
                            qrLabelSelectedElement
                          ].inverted
                            ? "#ffffff"
                            : colors.foreground,
                        fontSize: 11,
                        fontWeight: "900",
                      }}
                    >
                      ⬛ تظليل
                    </Text>
                  </Pressable>
                </View>
              )}

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  flexWrap: "wrap",
                  justifyContent:
                    "center",
                  gap: 6,
                }}
              >
                <Pressable
                  onPress={() =>
                    changeQrLabelElementPosition(
                      0,
                      -3,
                    )
                  }
                  style={{
                    padding: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text>↑</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    changeQrLabelElementPosition(
                      0,
                      3,
                    )
                  }
                  style={{
                    padding: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text>↓</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    changeQrLabelElementPosition(
                      -3,
                      0,
                    )
                  }
                  style={{
                    padding: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text>←</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    changeQrLabelElementPosition(
                      3,
                      0,
                    )
                  }
                  style={{
                    padding: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text>→</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    changeQrLabelElementSize(
                      -1,
                    )
                  }
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                    }}
                  >
                    − الحجم
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    changeQrLabelElementSize(
                      1,
                    )
                  }
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "900",
                    }}
                  >
                    + الحجم
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    updateQrLabelElement(
                      qrLabelSelectedElement,
                      {
                        visible:
                          !qrLabelLayout[
                            qrLabelSelectedElement
                          ].visible,
                      },
                    )
                  }
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "800",
                    }}
                  >
                    {qrLabelLayout[
                      qrLabelSelectedElement
                    ].visible
                      ? "إخفاء العنصر"
                      : "إظهار العنصر"}
                  </Text>
                </Pressable>
              </View>

              <View
                style={{
                  flexDirection:
                    "row-reverse",
                  gap: 6,
                }}
              >
                <Pressable
                  onPress={
                    saveQrLabelLayout
                  }
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor:
                      colors.primary,
                    alignItems:
                      "center",
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontWeight: "900",
                    }}
                  >
                    حفظ التصميم
                  </Text>
                </Pressable>

                <Pressable
                  onPress={
                    resetQrLabelLayout
                  }
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor:
                      colors.border,
                    alignItems:
                      "center",
                  }}
                >
                  <Text
                    style={{
                      color:
                        colors.foreground,
                      fontWeight: "800",
                    }}
                  >
                    التصميم الأصلي
                  </Text>
                </Pressable>
              </View>

              {!!qrLabelLayoutMessage && (
                <Text
                  style={{
                    color:
                      qrLabelLayoutMessage.startsWith(
                        "✓",
                      )
                        ? "#15803d"
                        : colors.mutedForeground,
                    fontSize: 11,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {qrLabelLayoutMessage}
                </Text>
              )}
            </View>

            <Text
              style={{
                color:
                  colors.mutedForeground,
                fontSize: 11,
                textAlign: "center",
              }}
            >
              أول ملصق محدد ظاهر في المعاينة.
              الطباعة ستشمل جميع الملصقات والنسخ التي اخترتها.
            </Text>

            <View
              style={{
                flexDirection:
                  Platform.OS === "web"
                    ? "row-reverse"
                    : "row",
                gap: 8,
              }}
            >
              <Pressable
                onPress={() =>
                  void handlePreviewAndPrintQrs()
                }
                disabled={printingQrs}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 12,
                  backgroundColor:
                    "#0f766e",
                  alignItems: "center",
                  justifyContent:
                    "center",
                  flexDirection:
                    Platform.OS === "web"
                      ? "row-reverse"
                      : "row",
                  gap: 8,
                  opacity:
                    printingQrs
                      ? 0.65
                      : 1,
                }}
              >
                <Ionicons
                  name="print-outline"
                  size={20}
                  color="#fff"
                />

                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "900",
                    fontSize: 14,
                  }}
                >
                  {printingQrs
                    ? "جارٍ الطباعة..."
                    : "طباعة الآن"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setQrPreviewOpen(false);
                  setQrPrintOpen(true);
                }}
                disabled={printingQrs}
                style={{
                  minWidth: 120,
                  minHeight: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor:
                    colors.border,
                  alignItems: "center",
                  justifyContent:
                    "center",
                }}
              >
                <Text
                  style={{
                    color:
                      colors.foreground,
                    fontWeight: "800",
                  }}
                >
                  رجوع للتحديد
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={qrGenerateOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQrGenerateOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: Platform.OS === "web" ? 420 : "100%",
              maxWidth: 420,
              borderRadius: 20,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 20,
              gap: 12,
            }}
          >
            <View
              style={{
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <Ionicons
                name="qr-code-outline"
                size={44}
                color={colors.primary}
              />

              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 19,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                توليد QR للموديل
              </Text>

              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  textAlign: "center",
                  lineHeight: 20,
                }}
              >
                سيتم إنشاء رمز QR منفصل لكل لون ونمرة.
                الباركود القديم لن يتم حذفه أو تغييره.
              </Text>
            </View>

            <Pressable
              onPress={() =>
                handleGenerateVariantQrs("missing")
              }
              style={{
                minHeight: 60,
                borderRadius: 14,
                backgroundColor: colors.primary,
                paddingHorizontal: 14,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                توليد QR للناقص فقط
              </Text>

              <Text
                style={{
                  color: "#fff",
                  opacity: 0.9,
                  fontSize: 12,
                  textAlign: "center",
                  marginTop: 3,
                }}
              >
                يترك أي لون ونمرة لديها رمز سابق كما هي
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                handleGenerateVariantQrs("all")
              }
              style={{
                minHeight: 60,
                borderRadius: 14,
                backgroundColor: "#111827",
                paddingHorizontal: 14,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                توليد QR للكل
              </Text>

              <Text
                style={{
                  color: "#fff",
                  opacity: 0.85,
                  fontSize: 12,
                  textAlign: "center",
                  marginTop: 3,
                }}
              >
                ينشئ QR خاص بـ Lovely Kids لكل لون ونمرة مع إبقاء الرموز القديمة
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setQrGenerateOpen(false)}
              style={{
                minHeight: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontWeight: "700",
                }}
              >
                إلغاء
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={scannerOpen}
        animationType="fade"
        onRequestClose={() => setScannerOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: Platform.OS === "web" ? 360 : "92%",
              maxWidth: 420,
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: "#111",
            }}
          >
            {Platform.OS === "web" ? (
              React.createElement(
                "video",
                {
                  id: "add-product-barcode-video",
                  autoPlay: true,
                  muted: true,
                  playsInline: true,
                  style: {
                    width: "100%",
                    height: 250,
                    objectFit: "cover",
                    backgroundColor: "#000",
                  },
                } as any
              )
            ) : (
              <CameraView
                style={{ width: "100%", height: 250 }}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: [
                    "ean13", "ean8", "upc_a", "upc_e",
                    "code128", "code39", "code93",
                    "itf14", "codabar", "qr",
                  ],
                }}
                onBarcodeScanned={
                  barcodeScanned
                    ? undefined
                    : ({ data }) => handleBarcodeScanned(data)
                }
              />
            )}

            <View style={{ padding: 14, alignItems: "center", gap: 10 }}>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>
                وجّه الكاميرا نحو الباركود أو QR
              </Text>
              <Pressable
                onPress={() => setScannerOpen(false)}
                style={{
                  backgroundColor: "#333",
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                  borderRadius: 22,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>إغلاق ✕</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  header: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  form: { padding: 16, gap: 16 },
  errorBox: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  errorText: { fontSize: 13, fontWeight: "600" },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: "700", textAlign: "right" },
  input: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  textArea: { height: 80, textAlignVertical: "top" },
  hint: { fontSize: 11, textAlign: "right" },
  row: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 10 },
  stockRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  stockInput: { flex: 1, fontSize: 14, padding: 0 },
  uploadBox: { borderWidth: 2, borderStyle: "dashed", borderRadius: 16, padding: 32, alignItems: "center", gap: 10 },
  uploadText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  uploadHint: { fontSize: 12, textAlign: "center" },
  imageGrid: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 10 },
  gridItem: { width: 100, height: 100, borderRadius: 12, borderWidth: 2, overflow: "hidden", position: "relative", backgroundColor: "#f8f8f8" },
  gridImage: { width: "100%", height: "100%" },
  mainBadge: { position: "absolute", top: 4, right: 4, zIndex: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  mainBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  gridActions: { position: "absolute", bottom: 4, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 },
  gridBtn: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  gridAddBtn: { width: 100, height: 100, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4 },
  gridAddText: { fontSize: 11, fontWeight: "700" },
  urlRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: 1, marginTop: 4 },
  urlLabel: { fontSize: 12 },
  sizeInputRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  addSizeBtn: { paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  sizeTextInput: { flex: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  sizesWrap: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 8 },
  sizeChip: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  sizeChipText: { fontSize: 13, fontWeight: "700" },
  chipsWrap: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  toggleRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  toggle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  saveBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, marginTop: 8 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  genderRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  genderOption: { flex: 1, flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  genderOptionText: { fontSize: 14, fontWeight: "700" },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1 },
  colorCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10 },
  colorCardHeader: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between" },
  colorCardTitle: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8 },
  colorCardName: { fontSize: 14, fontWeight: "700" },
  colorImageRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row" },
  colorImageWrap: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 8 },
  colorImageThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#f8f8f8" },
  colorImageActions: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", gap: 6 },
  colorImageAddBtn: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: "stretch", justifyContent: "center" },
  colorImageAddText: { fontSize: 12, fontWeight: "700" },
  colorSizeChipWrap: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center" },
  colorSizeRemoveBtn: { marginRight: -6, marginLeft: 2 },
  colorSizesList: { gap: 8 },
  colorSizeRow: { flexDirection: Platform.OS === "web" ? "row-reverse" : "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  colorSizeStockInput: { width: 48, fontSize: 14, fontWeight: "700", paddingVertical: 4, textAlignVertical: "center" },
});

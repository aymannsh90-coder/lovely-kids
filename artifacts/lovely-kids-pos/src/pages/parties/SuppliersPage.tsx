import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { usePosRuntime } from "../../app/pos-context";
import {
  ApiError,
  createPosSupplier,
  getPosSuppliers,
  type PosSupplier,
} from "../../lib/api";

const SUPPLIER_API_ENABLED =
  import.meta.env.VITE_PURCHASE_API_ENABLED === "true";

const SUPPLIER_WRITES_ENABLED =
  SUPPLIER_API_ENABLED &&
  import.meta.env.VITE_PURCHASE_WRITES === "true";

type StatusFilter = "all" | "active" | "inactive";

interface SupplierForm {
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  notes: string;
}

const emptyForm: SupplierForm = {
  code: "",
  name: "",
  contactPerson: "",
  phone: "",
  mobile: "",
  email: "",
  address: "",
  notes: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع";
}

export default function SuppliersPage() {
  const { token, clearAuthentication } = usePosRuntime();

  const [suppliers, setSuppliers] = useState<PosSupplier[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");

  const [form, setForm] = useState<SupplierForm>(emptyForm);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const activeCount = useMemo(
    () =>
      suppliers.filter(
        (supplier) => supplier.status === "active",
      ).length,
    [suppliers],
  );

  const inactiveCount = suppliers.length - activeCount;

  useEffect(() => {
    if (SUPPLIER_API_ENABLED) {
      void loadSuppliers("", "all");
    }
  }, [token]);

  async function loadSuppliers(
    nextQuery = query,
    nextStatus: StatusFilter = statusFilter,
  ) {
    if (!SUPPLIER_API_ENABLED) {
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const result = await getPosSuppliers(token, {
        query: nextQuery.trim() || undefined,
        status:
          nextStatus === "all"
            ? undefined
            : nextStatus,
      });

      setSuppliers(result.results);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function updateForm(
    field: keyof SupplierForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSearch(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void loadSuppliers();
  }

  async function handleCreateSupplier(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!SUPPLIER_WRITES_ENABLED) {
      setError(
        "إضافة الموردين محمية حتى نشر API المشتريات وتفعيل الكتابة.",
      );
      return;
    }

    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();

    if (!code) {
      setError("أدخل رمز المورد.");
      return;
    }

    if (!name) {
      setError("أدخل اسم المورد.");
      return;
    }

    const confirmed = window.confirm(
      [
        `سيتم إضافة المورد: ${name}`,
        `الرمز: ${code}`,
        "",
        "هل تريد المتابعة؟",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = await createPosSupplier(token, {
        code,
        name,
        contactPerson:
          form.contactPerson.trim() || undefined,
        phone: form.phone.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
        status: "active",
      });

      setSuppliers((current) => [
        result.supplier,
        ...current.filter(
          (supplier) =>
            supplier.id !== result.supplier.id,
        ),
      ]);

      setForm(emptyForm);

      setMessage(
        `تمت إضافة المورد ${result.supplier.name} بنجاح.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 401
      ) {
        clearAuthentication();
        return;
      }

      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="accounting-invoice-page suppliers-page">
      <div className="panel-heading">
        <div className="panel-icon">🚚</div>

        <div>
          <h2>إدارة الموردين</h2>

          <p>
            إضافة الموردين والبحث في بياناتهم قبل تسجيل
            فواتير المشتريات.
          </p>
        </div>
      </div>

      {!SUPPLIER_API_ENABLED && (
        <div className="alert supplier-protection-alert">
          واجهة الموردين جاهزة للمعاينة، والاتصال بالـAPI
          محمي حتى نشر Worker المشتريات.
        </div>
      )}

      <section className="supplier-summary-grid">
        <article>
          <span>إجمالي الموردين</span>
          <strong>{suppliers.length}</strong>
        </article>

        <article>
          <span>موردون فعالون</span>
          <strong>{activeCount}</strong>
        </article>

        <article>
          <span>موردون غير فعالين</span>
          <strong>{inactiveCount}</strong>
        </article>
      </section>

      <form
        className="accounting-invoice-card supplier-create-form"
        onSubmit={handleCreateSupplier}
      >
        <h2>إضافة مورد جديد</h2>

        <div className="accounting-fields-grid">
          <label>
            <span>رمز المورد *</span>
            <input
              dir="ltr"
              autoComplete="off"
              placeholder="SUP-001"
              value={form.code}
              onChange={(event) =>
                updateForm("code", event.target.value)
              }
            />
          </label>

          <label className="accounting-wide-field">
            <span>اسم المورد *</span>
            <input
              placeholder="اسم الشركة أو المورد"
              value={form.name}
              onChange={(event) =>
                updateForm("name", event.target.value)
              }
            />
          </label>

          <label>
            <span>جهة الاتصال</span>
            <input
              placeholder="اسم الشخص المسؤول"
              value={form.contactPerson}
              onChange={(event) =>
                updateForm(
                  "contactPerson",
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            <span>الهاتف</span>
            <input
              dir="ltr"
              inputMode="tel"
              value={form.phone}
              onChange={(event) =>
                updateForm("phone", event.target.value)
              }
            />
          </label>

          <label>
            <span>الجوال</span>
            <input
              dir="ltr"
              inputMode="tel"
              value={form.mobile}
              onChange={(event) =>
                updateForm("mobile", event.target.value)
              }
            />
          </label>

          <label>
            <span>البريد الإلكتروني</span>
            <input
              dir="ltr"
              type="email"
              value={form.email}
              onChange={(event) =>
                updateForm("email", event.target.value)
              }
            />
          </label>

          <label className="accounting-wide-field">
            <span>العنوان</span>
            <input
              value={form.address}
              onChange={(event) =>
                updateForm("address", event.target.value)
              }
            />
          </label>

          <label className="accounting-wide-field">
            <span>ملاحظات</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) =>
                updateForm("notes", event.target.value)
              }
            />
          </label>
        </div>

        <div className="supplier-form-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={
              saving || !SUPPLIER_WRITES_ENABLED
            }
            title={
              SUPPLIER_WRITES_ENABLED
                ? undefined
                : "الحفظ محمي حتى نشر API المشتريات"
            }
          >
            {saving ? "جاري الحفظ…" : "حفظ المورد"}
          </button>

          <button
            className="secondary-button"
            type="button"
            disabled={saving}
            onClick={() => {
              setForm(emptyForm);
              setError("");
              setMessage("");
            }}
          >
            تفريغ الحقول
          </button>
        </div>
      </form>

      <section className="accounting-invoice-card supplier-list-card">
        <div className="supplier-list-heading">
          <div>
            <h2>قائمة الموردين</h2>
            <p>ابحث بالاسم أو الرمز أو رقم الاتصال.</p>
          </div>

          <button
            className="secondary-button"
            type="button"
            disabled={
              loading || !SUPPLIER_API_ENABLED
            }
            onClick={() => void loadSuppliers()}
          >
            تحديث
          </button>
        </div>

        <form
          className="supplier-search-form"
          onSubmit={handleSearch}
        >
          <input
            placeholder="بحث باسم المورد أو الرمز أو الهاتف"
            value={query}
            disabled={!SUPPLIER_API_ENABLED}
            onChange={(event) =>
              setQuery(event.target.value)
            }
          />

          <select
            value={statusFilter}
            disabled={!SUPPLIER_API_ENABLED}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as StatusFilter,
              )
            }
          >
            <option value="all">جميع الحالات</option>
            <option value="active">فعال</option>
            <option value="inactive">غير فعال</option>
          </select>

          <button
            className="primary-button"
            type="submit"
            disabled={
              loading || !SUPPLIER_API_ENABLED
            }
          >
            {loading ? "جاري البحث…" : "بحث"}
          </button>
        </form>

        <div className="accounting-entry-feedback">
          {error && (
            <span className="is-error">{error}</span>
          )}

          {!error && message && (
            <span className="is-success">{message}</span>
          )}
        </div>

        <div className="accounting-invoice-table-wrap">
          <table className="accounting-invoice-table supplier-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الرمز</th>
                <th>اسم المورد</th>
                <th>جهة الاتصال</th>
                <th>الهاتف / الجوال</th>
                <th>الحالة</th>
                <th>العنوان</th>
              </tr>
            </thead>

            <tbody>
              {suppliers.length === 0 ? (
                <tr className="accounting-empty-row">
                  <td colSpan={7}>
                    {SUPPLIER_API_ENABLED
                      ? loading
                        ? "جاري تحميل الموردين…"
                        : "لا يوجد موردون مطابقون."
                      : "سيتم عرض الموردين هنا بعد نشر وتفعيل API المشتريات."}
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier, index) => (
                  <tr key={supplier.id}>
                    <td>{index + 1}</td>

                    <td dir="ltr">
                      <strong>{supplier.code}</strong>
                    </td>

                    <td>{supplier.name}</td>

                    <td>
                      {supplier.contactPerson ?? "—"}
                    </td>

                    <td dir="ltr">
                      {[supplier.phone, supplier.mobile]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </td>

                    <td>
                      <span
                        className={
                          supplier.status === "active"
                            ? "supplier-status is-active"
                            : "supplier-status is-inactive"
                        }
                      >
                        {supplier.status === "active"
                          ? "فعال"
                          : "غير فعال"}
                      </span>
                    </td>

                    <td>{supplier.address ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

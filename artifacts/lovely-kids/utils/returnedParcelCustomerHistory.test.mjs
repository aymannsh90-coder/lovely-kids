import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReturnedParcelMobile,
  buildReturnedParcelHistoryIndex,
  getPriorReturnedParcels,
} from "./returnedParcelCustomerHistory.ts";

const refused = {
  id: 334, customerName: "الاسم الأول", customerPhone: "059-123-4567",
  createdAt: "2026-11-09T15:40:37.000Z",
  status: "returning", failedDeliveryReturnStatus: "pending",
  failedDeliveryReturnReportedAt: "2026-11-16T10:30:52.863Z",
  failedDeliveryReturnReason: "لم ترد على الهاتف",
};

test("normalizes 059, 970, 972, Arabic and Persian digits equivalently", () => {
  for (const phone of [
    "0591234567", "591234567", "+970 59 123 4567",
    "00972(0)59-123-4567", "٠٥٩١٢٣٤٥٦٧", "۰۵۹۱۲۳۴۵۶۷",
  ]) assert.equal(normalizeReturnedParcelMobile(phone), "591234567", phone);
});

test("short, unknown and mismatched foreign formats are not treated as customer identities", () => {
  for (const phone of ["", "1234", "234567890", "15551234567", "+44 7911 123456", "05912345678"]) {
    assert.equal(normalizeReturnedParcelMobile(phone), null, phone);
  }
});

test("a later order with a different name, same phone, gets the pending-return warning", () => {
  const later = {
    id: 350, customerName: "اسم مختلف", customerPhone: "+972 59 123 4567",
    createdAt: "2026-11-17T10:00:00.000Z", status: "new",
  };
  const entries = getPriorReturnedParcels(later, buildReturnedParcelHistoryIndex([refused, later]));
  assert.deepEqual(entries.map(({orderId, state}) => ({orderId, state})), [{orderId:334,state:"pending"}]);
});

test("same name with a different phone does not get marked", () => {
  const later = { id:350, customerName:refused.customerName, customerPhone:"0590000000",
    createdAt:"2026-11-17T10:00:00.000Z", status:"new" };
  assert.deepEqual(getPriorReturnedParcels(later, buildReturnedParcelHistoryIndex([refused, later])), []);
});

test("historical orders and the returned parcel itself get no new-order warning", () => {
  const old = { id:330, customerName:"Old name",customerPhone:refused.customerPhone,
    createdAt:"2026-11-12T00:00:00.000Z",status:"done" };
  const index = buildReturnedParcelHistoryIndex([refused, old]);
  assert.deepEqual(getPriorReturnedParcels(old,index),[]);
  assert.deepEqual(getPriorReturnedParcels(refused,index),[]);
});

test("received returns remain in history while showing a distinct, calmer state", () => {
  const received = { ...refused, status:"cancelled", failedDeliveryReturnStatus:"received" };
  const newOrder = { id:350, customerName:"Different", customerPhone:"0591234567",
    createdAt:"2026-11-17T00:00:00Z", status:"confirmed" };
  const history = getPriorReturnedParcels(newOrder,buildReturnedParcelHistoryIndex([received,newOrder]));
  assert.equal(history.length,1);
  assert.equal(history[0].state,"received");
});

test("ordinary cancelled orders, merged rows and inconsistent returns do not flag customers", () => {
  const invalid = [
    {...refused,id:1,status:"cancelled",failedDeliveryReturnStatus:null},
    {...refused,id:2,status:"done"},
    {...refused,id:3,mergedIntoOrderId:4},
    {...refused,id:4,failedDeliveryReturnReportedAt:null},
  ];
  assert.equal(buildReturnedParcelHistoryIndex(invalid).size,0);
});

test("multiple incidents are sorted newest first and distinguish active vs received", () => {
  const prior = { ...refused, id:99, status:"cancelled",failedDeliveryReturnStatus:"received",
    failedDeliveryReturnReportedAt:"2026-11-14T10:00:00Z" };
  const later = { id:350,customerName:"New",customerPhone:"0591234567",
    createdAt:"2026-11-17T10:00:00Z",status:"new" };
  const history = getPriorReturnedParcels(later,buildReturnedParcelHistoryIndex([prior,refused,later]));
  assert.deepEqual(history.map(x=>[x.orderId,x.state]),[[334,"pending"],[99,"received"]]);
});

type Props = {
  phone: string;
  orderId: number;
  getAuthToken?: (() => Promise<string | null>) | null;
};

export default function GuestOrderNotificationPrompt(
  _props: Props,
) {
  return null;
}

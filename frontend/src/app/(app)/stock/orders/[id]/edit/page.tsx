import { OrderForm } from "../../_components/order-form";

export default function EditOrderPage({ params }: { params: { id: string } }) {
  return <OrderForm orderId={params.id} />;
}

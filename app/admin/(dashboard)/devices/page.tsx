import { DeviceList } from "./DeviceList";

export default function DevicesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tablets</h1>
      <DeviceList />
    </div>
  );
}

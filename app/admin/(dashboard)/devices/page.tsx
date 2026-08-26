import { DeviceList } from "./DeviceList";

export default function DevicesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">Tablets</h1>
      <DeviceList />
    </div>
  );
}

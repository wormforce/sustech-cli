export type FacilityKind = "building" | "gate" | "bus_stop";

export interface Facility {
  id: string;
  name: string;
  nameEn: string;
  kind: FacilityKind;
  lat: number;
  lng: number;
  routes: string[];
}

export interface BusSubRoute {
  index: number;
  name: string;
  description: string;
  kind: string;
  color: string;
  lineCode: string;
  direction: number;
  sources: Array<{ url: string; type: string }>;
}

export interface BusLine {
  id: string;
  title: string;
  routes: BusSubRoute[];
}

export interface BusSchedule {
  lineId: string;
  title: string;
  dayType: "workday" | "holiday";
  routeIndex: number;
  routeName: string;
  routeDescription: string;
  color: string;
  times: string[];
  minuteOnRoad?: number;
}

export interface LiveBus {
  id: string;
  lat: number;
  lng: number;
  speedKmh: number;
  bearing: number;
  operating: boolean;
  routeCode: string;
  nextStation: string;
  previousStationId: string;
  timestamp: number;
  source: "bus" | "shuttle";
}

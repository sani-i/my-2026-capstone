export const mockEvents = [
  {
    id: "evt-1",
    title: "Lagos Tech Meetup",
    city: "Lagos",
    venue: "Landmark Centre",
    startsAt: "2026-12-05T17:00:00Z",
    status: "published",
    tiers: [
      { id: "tier-1a", eventId: "evt-1", name: "General", priceCents: 500000, capacity: 100, sold: 20, seatsLeft: 80 },
      { id: "tier-1b", eventId: "evt-1", name: "VIP", priceCents: 1500000, capacity: 20, sold: 20, seatsLeft: 0 },
    ],
  },
  {
    id: "evt-2",
    title: "Abuja Jazz Night",
    city: "Abuja",
    venue: "Musa Yar'Adua Centre",
    startsAt: "2026-12-20T19:00:00Z",
    status: "published",
    tiers: [
      { id: "tier-2a", eventId: "evt-2", name: "Regular", priceCents: 250000, capacity: 50, sold: 10, seatsLeft: 40 },
      { id: "tier-2b", eventId: "evt-2", name: "Front Row", priceCents: 750000, capacity: 10, sold: 2, seatsLeft: 8 },
    ],
  },
  {
    id: "evt-3",
    title: "Port Harcourt Food Fest",
    city: "Port Harcourt",
    venue: "Pleasure Park",
    startsAt: "2027-01-10T12:00:00Z",
    status: "published",
    tiers: [
      { id: "tier-3a", eventId: "evt-3", name: "Taster", priceCents: 150000, capacity: 200, sold: 50, seatsLeft: 150 },
    ],
  },
];

export function getMockEvents() {
  return structuredClone(mockEvents);
}

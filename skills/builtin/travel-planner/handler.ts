// ─── Travel Planner Skill Handler ─────────────────────────────────────────
//
// Creates travel itineraries with flights, hotels, attractions,
// day-by-day plans, calendar integration, and budget tracking.
//
// ───────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:travel-planner" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface Trip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: BudgetInfo;
  itinerary: DayPlan[];
  flights: FlightOption[];
  hotels: HotelOption[];
  attractions: Attraction[];
  createdAt: string;
}

interface BudgetInfo {
  total: number;
  currency: string;
  allocated: Record<string, number>;
  spent: Record<string, number>;
}

interface DayPlan {
  date: string;
  dayNumber: number;
  morning: ActivitySlot;
  afternoon: ActivitySlot;
  evening: ActivitySlot;
  transport: string;
  estimatedCost: number;
}

interface ActivitySlot {
  activity: string;
  location: string;
  estimatedCost: number;
  notes?: string;
}

interface FlightOption {
  airline: string;
  departure: string;
  arrival: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  currency: string;
  stops: number;
}

interface HotelOption {
  name: string;
  location: string;
  pricePerNight: number;
  currency: string;
  rating: number;
  amenities: string[];
}

interface Attraction {
  name: string;
  description: string;
  estimatedDuration: string;
  estimatedCost: number;
  category: string;
}

// ─── Budget Categories ──────────────────────────────────────────────────────

const BUDGET_CATEGORIES = [
  "flights",
  "accommodation",
  "food",
  "activities",
  "shopping",
  "miscellaneous",
];

const DEFAULT_BUDGET_ALLOCATION: Record<string, number> = {
  flights: 0.30,
  accommodation: 0.25,
  food: 0.20,
  activities: 0.10,
  shopping: 0.05,
  miscellaneous: 0.10,
};

// ─── Handler ────────────────────────────────────────────────────────────────

export class TravelPlannerHandler implements SkillHandler {
  private trips: Map<string, Trip> = new Map();

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Travel planner skill initialized");
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing travel planner action");

    try {
      switch (action) {
        case "plan":
          return this.createPlan(input, context);
        case "flights":
          return this.searchFlights(input, context);
        case "hotels":
          return this.searchHotels(input, context);
        case "attractions":
          return this.findAttractions(input, context);
        case "budget":
          return this.viewBudget(input);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Travel planner action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    this.trips.clear();
    logger.info("Travel planner skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async createPlan(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const destination = (input["destination"] as string) ?? "";
    const startDate = (input["startDate"] as string) ?? "";
    const endDate = (input["endDate"] as string) ?? "";
    const budgetTotal = (input["budget"] as number) ?? 0;
    const currency = (input["currency"] as string)?.toUpperCase() ?? "USD";

    if (!destination) {
      return { success: false, output: "Please specify a destination.", error: "Missing destination" };
    }
    if (!startDate || !endDate) {
      return { success: false, output: "Please specify start and end dates (YYYY-MM-DD).", error: "Missing dates" };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0 || days > 60) {
      return { success: false, output: "Invalid date range. Trip must be 1-60 days.", error: "Invalid dates" };
    }

    // Allocate budget
    const allocated: Record<string, number> = {};
    for (const [cat, pct] of Object.entries(DEFAULT_BUDGET_ALLOCATION)) {
      allocated[cat] = Math.round(budgetTotal * pct);
    }

    // Search for data (stubs until tool integration)
    const flights = await this.fetchFlights(destination, startDate, context);
    const hotels = await this.fetchHotels(destination, startDate, endDate, context);
    const attractions = await this.fetchAttractions(destination, context);

    // Generate day-by-day itinerary
    const itinerary = this.generateItinerary(destination, startDate, days, attractions);

    const trip: Trip = {
      id: randomUUID().slice(0, 8),
      destination,
      startDate,
      endDate,
      budget: {
        total: budgetTotal,
        currency,
        allocated,
        spent: Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, 0])),
      },
      itinerary,
      flights,
      hotels,
      attractions,
      createdAt: new Date().toISOString(),
    };

    this.trips.set(trip.id, trip);

    return {
      success: true,
      output: this.formatTripPlan(trip),
      data: { tripId: trip.id, destination, days, budget: budgetTotal } as Record<string, unknown>,
    };
  }

  private async searchFlights(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const from = (input["from"] as string) ?? "";
    const to = (input["to"] as string) ?? "";
    const date = (input["date"] as string) ?? "";

    if (!from || !to) {
      return { success: false, output: "Specify departure (from) and arrival (to) cities.", error: "Missing params" };
    }

    const flights = await this.fetchFlights(to, date, context);

    if (flights.length === 0) {
      return {
        success: true,
        output: `No flight data available yet. Connect the web_search tool to enable flight search from ${from} to ${to}.`,
      };
    }

    const lines = flights.map(
      (f) =>
        `• ${f.airline}: ${f.departureTime} -> ${f.arrivalTime} | ${f.currency} ${f.price} | ${f.stops} stop(s)`
    );

    return {
      success: true,
      output: `Flights from ${from} to ${to}:\n${lines.join("\n")}`,
      data: { flights } as unknown as Record<string, unknown>,
    };
  }

  private async searchHotels(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const location = (input["location"] as string) ?? "";
    const checkIn = (input["checkIn"] as string) ?? "";
    const checkOut = (input["checkOut"] as string) ?? "";

    if (!location) {
      return { success: false, output: "Specify a hotel location.", error: "Missing location" };
    }

    const hotels = await this.fetchHotels(location, checkIn, checkOut, context);

    if (hotels.length === 0) {
      return {
        success: true,
        output: `No hotel data available yet. Connect the web_search tool to enable hotel search in ${location}.`,
      };
    }

    const lines = hotels.map(
      (h) =>
        `• ${h.name} (${h.rating}/5) — ${h.currency} ${h.pricePerNight}/night\n  ${h.amenities.join(", ")}`
    );

    return {
      success: true,
      output: `Hotels in ${location}:\n${lines.join("\n\n")}`,
      data: { hotels } as unknown as Record<string, unknown>,
    };
  }

  private async findAttractions(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const location = (input["location"] as string) ?? "";
    if (!location) {
      return { success: false, output: "Specify a location to find attractions.", error: "Missing location" };
    }

    const attractions = await this.fetchAttractions(location, context);

    if (attractions.length === 0) {
      return {
        success: true,
        output: `No attraction data available yet. Connect the web_search tool to find things to do in ${location}.`,
      };
    }

    const lines = attractions.map(
      (a) => `• ${a.name} [${a.category}] — ${a.estimatedDuration}\n  ${a.description}`
    );

    return {
      success: true,
      output: `Attractions in ${location}:\n${lines.join("\n\n")}`,
      data: { attractions } as unknown as Record<string, unknown>,
    };
  }

  private async viewBudget(input: Record<string, unknown>): Promise<SkillResult> {
    const tripId = input["tripId"] as string;
    if (!tripId) {
      return { success: false, output: "Specify a trip ID to view budget.", error: "Missing tripId" };
    }

    const trip = this.trips.get(tripId);
    if (!trip) {
      return { success: false, output: `Trip "${tripId}" not found.`, error: "Trip not found" };
    }

    const { budget } = trip;
    const sym = budget.currency;

    const lines = [
      `Budget for ${trip.destination} Trip (${trip.startDate} to ${trip.endDate})`,
      `${"─".repeat(50)}`,
      "",
      `Category        Allocated    Spent        Remaining`,
      `${"─".repeat(50)}`,
    ];

    let totalSpent = 0;
    for (const cat of BUDGET_CATEGORIES) {
      const alloc = budget.allocated[cat] ?? 0;
      const spent = budget.spent[cat] ?? 0;
      totalSpent += spent;
      const remaining = alloc - spent;
      lines.push(
        `${cat.padEnd(16)}${sym} ${alloc.toString().padStart(8)}  ${sym} ${spent.toString().padStart(8)}  ${sym} ${remaining.toString().padStart(8)}`
      );
    }

    lines.push(`${"─".repeat(50)}`);
    lines.push(
      `${"Total".padEnd(16)}${sym} ${budget.total.toString().padStart(8)}  ${sym} ${totalSpent.toString().padStart(8)}  ${sym} ${(budget.total - totalSpent).toString().padStart(8)}`
    );

    return {
      success: true,
      output: lines.join("\n"),
      data: { budget, totalSpent } as unknown as Record<string, unknown>,
    };
  }

  // ─── Data Fetching (Stubs) ─────────────────────────────────────────────

  private async fetchFlights(
    _destination: string,
    _date: string,
    _context: SkillContext
  ): Promise<FlightOption[]> {
    logger.debug("Fetching flight options (stub)");
    return [];
  }

  private async fetchHotels(
    _location: string,
    _checkIn: string,
    _checkOut: string,
    _context: SkillContext
  ): Promise<HotelOption[]> {
    logger.debug("Fetching hotel options (stub)");
    return [];
  }

  private async fetchAttractions(
    _location: string,
    _context: SkillContext
  ): Promise<Attraction[]> {
    logger.debug("Fetching attractions (stub)");
    return [];
  }

  // ─── Itinerary Generation ──────────────────────────────────────────────

  private generateItinerary(
    destination: string,
    startDate: string,
    days: number,
    attractions: Attraction[]
  ): DayPlan[] {
    const plans: DayPlan[] = [];
    const start = new Date(startDate);

    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0]!;

      const morning = attractions[i * 3] ?? null;
      const afternoon = attractions[i * 3 + 1] ?? null;
      const evening = attractions[i * 3 + 2] ?? null;

      plans.push({
        date: dateStr,
        dayNumber: i + 1,
        morning: {
          activity: morning?.name ?? `Explore ${destination} — morning`,
          location: morning?.description ?? destination,
          estimatedCost: morning?.estimatedCost ?? 0,
        },
        afternoon: {
          activity: afternoon?.name ?? `Explore ${destination} — afternoon`,
          location: afternoon?.description ?? destination,
          estimatedCost: afternoon?.estimatedCost ?? 0,
        },
        evening: {
          activity: evening?.name ?? "Local dinner",
          location: `Restaurant in ${destination}`,
          estimatedCost: evening?.estimatedCost ?? 0,
        },
        transport: "Local transport / walking",
        estimatedCost:
          (morning?.estimatedCost ?? 0) +
          (afternoon?.estimatedCost ?? 0) +
          (evening?.estimatedCost ?? 0),
      });
    }

    return plans;
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatTripPlan(trip: Trip): string {
    const lines: string[] = [];

    lines.push(`Travel Plan: ${trip.destination}`);
    lines.push(`${trip.startDate} to ${trip.endDate} (${trip.itinerary.length} days)`);
    lines.push(`Budget: ${trip.budget.currency} ${trip.budget.total.toLocaleString()}`);
    lines.push(`Trip ID: ${trip.id}`);
    lines.push(`${"─".repeat(50)}\n`);

    // Flights
    if (trip.flights.length > 0) {
      lines.push("**Flights**");
      for (const f of trip.flights) {
        lines.push(`  ${f.airline}: ${f.departureTime} -> ${f.arrivalTime} — ${f.currency} ${f.price}`);
      }
      lines.push("");
    }

    // Hotels
    if (trip.hotels.length > 0) {
      lines.push("**Accommodation**");
      for (const h of trip.hotels) {
        lines.push(`  ${h.name} (${h.rating}/5) — ${h.currency} ${h.pricePerNight}/night`);
      }
      lines.push("");
    }

    // Itinerary
    lines.push("**Day-by-Day Itinerary**\n");
    for (const day of trip.itinerary) {
      lines.push(`Day ${day.dayNumber} (${day.date}):`);
      lines.push(`  Morning:   ${day.morning.activity}`);
      lines.push(`  Afternoon: ${day.afternoon.activity}`);
      lines.push(`  Evening:   ${day.evening.activity}`);
      lines.push(`  Transport: ${day.transport}`);
      lines.push("");
    }

    // Budget allocation
    lines.push("**Budget Allocation**");
    for (const [cat, amount] of Object.entries(trip.budget.allocated)) {
      lines.push(`  ${cat}: ${trip.budget.currency} ${amount.toLocaleString()}`);
    }

    lines.push(`\nNote: Connect the web_search tool for live flight, hotel, and attraction data.`);

    return lines.join("\n");
  }
}

export default TravelPlannerHandler;

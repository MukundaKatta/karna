// ─── Travel Planner Skill Handler ─────────────────────────────────────────
//
// Creates travel itineraries with flights, hotels, attractions,
// day-by-day plans, calendar integration, and budget tracking.
// Persists trip data to ~/.karna/trips.json.
//
// ───────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
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

interface TripStore {
  version: number;
  trips: Trip[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_DIR = join(homedir(), ".karna");
const STORAGE_FILE = join(STORAGE_DIR, "trips.json");

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

const ACTIVITY_EMOJIS: Record<string, string> = {
  sightseeing: "camera",
  museum: "classical_building",
  food: "fork_and_knife",
  shopping: "shopping_bags",
  nature: "national_park",
  adventure: "mountain",
  culture: "performing_arts",
  relaxation: "beach_with_umbrella",
  nightlife: "city_sunset",
  transport: "bus",
};

// ─── Handler ────────────────────────────────────────────────────────────────

export class TravelPlannerHandler implements SkillHandler {
  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Travel planner skill initialized");
    await this.ensureStorageExists();
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
        case "list":
          return this.listTrips();
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

    // Fetch data via web_search
    const [flights, hotels, attractions] = await Promise.allSettled([
      this.fetchFlights(destination, startDate, context),
      this.fetchHotels(destination, startDate, endDate, context),
      this.fetchAttractions(destination, context),
    ]);

    const resolvedFlights = flights.status === "fulfilled" ? flights.value : [];
    const resolvedHotels = hotels.status === "fulfilled" ? hotels.value : [];
    const resolvedAttractions = attractions.status === "fulfilled" ? attractions.value : [];

    // Generate day-by-day itinerary
    const itinerary = this.generateItinerary(destination, startDate, days, resolvedAttractions, budgetTotal);

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
      flights: resolvedFlights,
      hotels: resolvedHotels,
      attractions: resolvedAttractions,
      createdAt: new Date().toISOString(),
    };

    // Persist to disk
    const store = await this.loadStore();
    store.trips.push(trip);
    await this.saveStore(store);

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

    const flights = await this.fetchFlights(to, date, context, from);

    if (flights.length === 0) {
      return {
        success: true,
        output: `No flight data available for ${from} to ${to}. Connect the web_search tool for live results.`,
      };
    }

    const lines = flights.map(
      (f) =>
        `[plane] ${f.airline}: ${f.departure} -> ${f.arrival}\n    ${f.departureTime} -> ${f.arrivalTime} | ${f.currency} ${f.price} | ${f.stops} stop(s)`
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
        output: `No hotel data available for ${location}. Connect the web_search tool for live results.`,
      };
    }

    const lines = hotels.map(
      (h) =>
        `[hotel] ${h.name} (${"*".repeat(h.rating)})\n    ${h.currency} ${h.pricePerNight}/night | ${h.amenities.join(", ")}`
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
        output: `No attraction data available for ${location}. Connect the web_search tool for live results.`,
      };
    }

    const lines = attractions.map((a) => {
      const emoji = ACTIVITY_EMOJIS[a.category] ?? "pushpin";
      return `[${emoji}] ${a.name} [${a.category}] -- ${a.estimatedDuration}\n    ${a.description}${a.estimatedCost > 0 ? ` (~$${a.estimatedCost})` : " (Free)"}`;
    });

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

    const store = await this.loadStore();
    const trip = store.trips.find((t) => t.id === tripId);
    if (!trip) {
      return { success: false, output: `Trip "${tripId}" not found.`, error: "Trip not found" };
    }

    const { budget } = trip;
    const sym = budget.currency;

    const lines = [
      `Budget for ${trip.destination} Trip (${trip.startDate} to ${trip.endDate})`,
      `${"=".repeat(55)}`,
      "",
      `Category        Allocated    Spent        Remaining`,
      `${"─".repeat(55)}`,
    ];

    let totalSpent = 0;
    for (const cat of BUDGET_CATEGORIES) {
      const alloc = budget.allocated[cat] ?? 0;
      const spent = budget.spent[cat] ?? 0;
      totalSpent += spent;
      const remaining = alloc - spent;
      const status = remaining < 0 ? " [OVER]" : "";
      lines.push(
        `${cat.padEnd(16)}${sym} ${alloc.toString().padStart(8)}  ${sym} ${spent.toString().padStart(8)}  ${sym} ${remaining.toString().padStart(8)}${status}`
      );
    }

    lines.push(`${"─".repeat(55)}`);
    lines.push(
      `${"Total".padEnd(16)}${sym} ${budget.total.toString().padStart(8)}  ${sym} ${totalSpent.toString().padStart(8)}  ${sym} ${(budget.total - totalSpent).toString().padStart(8)}`
    );

    const pctUsed = budget.total > 0 ? Math.round((totalSpent / budget.total) * 100) : 0;
    lines.push(`\nBudget used: ${pctUsed}%`);

    return {
      success: true,
      output: lines.join("\n"),
      data: { budget, totalSpent } as unknown as Record<string, unknown>,
    };
  }

  private async listTrips(): Promise<SkillResult> {
    const store = await this.loadStore();

    if (store.trips.length === 0) {
      return { success: true, output: "No trips planned yet. Use the 'plan' action to create one." };
    }

    const lines = store.trips.map((t) => {
      const days = Math.ceil(
        (new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
      return `- [${t.id}] ${t.destination} | ${t.startDate} to ${t.endDate} (${days} days) | ${t.budget.currency} ${t.budget.total}`;
    });

    return {
      success: true,
      output: `Your Trips:\n${lines.join("\n")}`,
      data: { count: store.trips.length } as Record<string, unknown>,
    };
  }

  // ─── Data Fetching ────────────────────────────────────────────────────

  private async fetchFlights(
    destination: string,
    date: string,
    context: SkillContext,
    origin?: string
  ): Promise<FlightOption[]> {
    logger.debug({ destination, date }, "Fetching flight options");

    if (!context.callTool) {
      logger.debug("No callTool available — web_search not connected");
      return [];
    }

    try {
      const query = origin
        ? `flights from ${origin} to ${destination} ${date}`
        : `flights to ${destination} ${date}`;

      const result = await context.callTool("web_search", {
        query,
        maxResults: 5,
      });

      if (!result || typeof result !== "object") return [];

      const searchResults = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["results"])
          ? (result as { results: unknown[] }).results
          : [];

      // Parse flight information from search results
      const flights: FlightOption[] = [];
      for (const r of searchResults) {
        if (!r || typeof r !== "object") continue;
        const item = r as Record<string, unknown>;
        const title = (item["title"] as string) ?? "";
        const snippet = (item["snippet"] as string) ?? "";

        // Try to extract price from text
        const priceMatch = (title + " " + snippet).match(/\$\s*(\d+)/);
        const price = priceMatch ? parseInt(priceMatch[1]!, 10) : 0;

        if (title.toLowerCase().includes("flight") || snippet.toLowerCase().includes("flight")) {
          flights.push({
            airline: this.extractAirline(title + " " + snippet),
            departure: origin ?? "Origin",
            arrival: destination,
            departureTime: date || "Flexible",
            arrivalTime: "See details",
            price,
            currency: "USD",
            stops: snippet.toLowerCase().includes("nonstop") ? 0 : 1,
          });
        }
      }

      return flights.slice(0, 5);
    } catch (error) {
      logger.warn({ error: String(error) }, "Flight search failed");
      return [];
    }
  }

  private async fetchHotels(
    location: string,
    checkIn: string,
    checkOut: string,
    context: SkillContext
  ): Promise<HotelOption[]> {
    logger.debug({ location }, "Fetching hotel options");

    if (!context.callTool) return [];

    try {
      const result = await context.callTool("web_search", {
        query: `best hotels in ${location} ${checkIn}`,
        maxResults: 5,
      });

      if (!result || typeof result !== "object") return [];

      const searchResults = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["results"])
          ? (result as { results: unknown[] }).results
          : [];

      const hotels: HotelOption[] = [];
      for (const r of searchResults) {
        if (!r || typeof r !== "object") continue;
        const item = r as Record<string, unknown>;
        const title = (item["title"] as string) ?? "";
        const snippet = (item["snippet"] as string) ?? "";

        const priceMatch = (title + " " + snippet).match(/\$\s*(\d+)/);
        const ratingMatch = (title + " " + snippet).match(/(\d(?:\.\d)?)\s*(?:\/5|stars?|out of 5)/i);

        if (title.toLowerCase().includes("hotel") || snippet.toLowerCase().includes("hotel") || snippet.toLowerCase().includes("accommodation")) {
          hotels.push({
            name: this.extractHotelName(title),
            location,
            pricePerNight: priceMatch ? parseInt(priceMatch[1]!, 10) : 0,
            currency: "USD",
            rating: ratingMatch ? parseFloat(ratingMatch[1]!) : 4,
            amenities: this.extractAmenities(snippet),
          });
        }
      }

      return hotels.slice(0, 5);
    } catch (error) {
      logger.warn({ error: String(error) }, "Hotel search failed");
      return [];
    }
  }

  private async fetchAttractions(
    location: string,
    context: SkillContext
  ): Promise<Attraction[]> {
    logger.debug({ location }, "Fetching attractions");

    if (!context.callTool) return [];

    try {
      const result = await context.callTool("web_search", {
        query: `top attractions things to do in ${location}`,
        maxResults: 10,
      });

      if (!result || typeof result !== "object") return [];

      const searchResults = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["results"])
          ? (result as { results: unknown[] }).results
          : [];

      const attractions: Attraction[] = [];
      for (const r of searchResults) {
        if (!r || typeof r !== "object") continue;
        const item = r as Record<string, unknown>;
        const title = (item["title"] as string) ?? "";
        const snippet = (item["snippet"] as string) ?? "";

        const costMatch = snippet.match(/\$\s*(\d+)/);
        const category = this.categorizeAttraction(title + " " + snippet);

        attractions.push({
          name: this.cleanAttractionName(title),
          description: snippet.slice(0, 150),
          estimatedDuration: this.estimateDuration(snippet),
          estimatedCost: costMatch ? parseInt(costMatch[1]!, 10) : 0,
          category,
        });
      }

      // Deduplicate by name similarity
      const seen = new Set<string>();
      return attractions.filter((a) => {
        const key = a.name.toLowerCase().slice(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      logger.warn({ error: String(error) }, "Attraction search failed");
      return [];
    }
  }

  // ─── Itinerary Generation ──────────────────────────────────────────────

  private generateItinerary(
    destination: string,
    startDate: string,
    days: number,
    attractions: Attraction[],
    totalBudget: number
  ): DayPlan[] {
    const plans: DayPlan[] = [];
    const start = new Date(startDate);
    const dailyBudget = totalBudget > 0 ? Math.round(totalBudget / days) : 0;

    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0]!;

      const morning = attractions[i * 3] ?? null;
      const afternoon = attractions[i * 3 + 1] ?? null;
      const evening = attractions[i * 3 + 2] ?? null;

      const morningCost = morning?.estimatedCost ?? 0;
      const afternoonCost = afternoon?.estimatedCost ?? 0;
      const eveningCost = evening?.estimatedCost ?? Math.round(dailyBudget * 0.3);

      // First day: arrival/check-in, last day: departure
      const isFirstDay = i === 0;
      const isLastDay = i === days - 1;

      plans.push({
        date: dateStr,
        dayNumber: i + 1,
        morning: {
          activity: isFirstDay
            ? `Arrive in ${destination} & check in`
            : morning?.name ?? `Explore ${destination}`,
          location: isFirstDay
            ? `Airport / Hotel in ${destination}`
            : morning?.description ?? destination,
          estimatedCost: isFirstDay ? 0 : morningCost,
          notes: isFirstDay ? "Get settled, pick up local map/SIM" : undefined,
        },
        afternoon: {
          activity: isLastDay
            ? "Pack up & checkout"
            : afternoon?.name ?? `Discover local ${destination} neighborhoods`,
          location: isLastDay
            ? `Hotel in ${destination}`
            : afternoon?.description ?? destination,
          estimatedCost: isLastDay ? 0 : afternoonCost,
        },
        evening: {
          activity: isLastDay
            ? `Depart from ${destination}`
            : evening?.name ?? `Dinner at a local restaurant in ${destination}`,
          location: isLastDay
            ? `Airport in ${destination}`
            : `Restaurant in ${destination}`,
          estimatedCost: isLastDay ? 0 : eveningCost,
        },
        transport: isFirstDay || isLastDay
          ? "Airport transfer / taxi"
          : "Local transport / walking / metro",
        estimatedCost: morningCost + afternoonCost + eveningCost,
      });
    }

    return plans;
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatTripPlan(trip: Trip): string {
    const lines: string[] = [];
    const sym = trip.budget.currency;

    lines.push(`[world_map] Travel Plan: ${trip.destination}`);
    lines.push(`[calendar] ${trip.startDate} to ${trip.endDate} (${trip.itinerary.length} days)`);
    if (trip.budget.total > 0) {
      lines.push(`[money_bag] Budget: ${sym} ${trip.budget.total.toLocaleString()}`);
    }
    lines.push(`[ticket] Trip ID: ${trip.id}`);
    lines.push(`${"=".repeat(55)}\n`);

    // Flights
    if (trip.flights.length > 0) {
      lines.push("[airplane] **Flights**");
      for (const f of trip.flights) {
        lines.push(`  ${f.airline}: ${f.departure} -> ${f.arrival}`);
        lines.push(`    ${f.departureTime} -> ${f.arrivalTime} | ${f.currency} ${f.price} | ${f.stops} stop(s)`);
      }
      lines.push("");
    }

    // Hotels
    if (trip.hotels.length > 0) {
      lines.push("[hotel] **Accommodation Options**");
      for (const h of trip.hotels) {
        lines.push(`  ${h.name} (${"*".repeat(h.rating)}) -- ${h.currency} ${h.pricePerNight}/night`);
        if (h.amenities.length > 0) lines.push(`    Amenities: ${h.amenities.join(", ")}`);
      }
      lines.push("");
    }

    // Itinerary
    lines.push("[spiral_notepad] **Day-by-Day Itinerary**\n");
    for (const day of trip.itinerary) {
      lines.push(`--- Day ${day.dayNumber} (${day.date}) ---`);
      lines.push(`  [sunrise] Morning:   ${day.morning.activity}`);
      if (day.morning.notes) lines.push(`               Note: ${day.morning.notes}`);
      lines.push(`  [sun] Afternoon: ${day.afternoon.activity}`);
      lines.push(`  [moon] Evening:   ${day.evening.activity}`);
      lines.push(`  [bus] Transport: ${day.transport}`);
      if (day.estimatedCost > 0) {
        lines.push(`  [dollar] Est. cost:  ~${sym} ${day.estimatedCost}`);
      }
      lines.push("");
    }

    // Budget allocation
    if (trip.budget.total > 0) {
      lines.push("[bar_chart] **Budget Allocation**");
      for (const [cat, amount] of Object.entries(trip.budget.allocated)) {
        const pct = Math.round((amount / trip.budget.total) * 100);
        lines.push(`  ${cat.padEnd(16)} ${sym} ${amount.toLocaleString().padStart(8)} (${pct}%)`);
      }
    }

    // Attractions
    if (trip.attractions.length > 0) {
      lines.push("\n[star] **Top Attractions**");
      for (const a of trip.attractions.slice(0, 8)) {
        lines.push(`  - ${a.name} [${a.category}] (~${a.estimatedDuration})`);
      }
    }

    return lines.join("\n");
  }

  // ─── Parsing Helpers ──────────────────────────────────────────────────

  private extractAirline(text: string): string {
    const airlines = [
      "Delta", "United", "American", "Southwest", "JetBlue", "Spirit",
      "Alaska", "Frontier", "Hawaiian", "Emirates", "Qatar", "Lufthansa",
      "British Airways", "Air France", "KLM", "Singapore Airlines",
      "Air India", "IndiGo", "Ryanair", "EasyJet",
    ];
    const lower = text.toLowerCase();
    return airlines.find((a) => lower.includes(a.toLowerCase())) ?? "Airline";
  }

  private extractHotelName(title: string): string {
    // Remove common suffixes like "- Booking.com", "| TripAdvisor"
    return title.replace(/\s*[-|].+$/, "").trim().slice(0, 60) || "Hotel";
  }

  private extractAmenities(text: string): string[] {
    const amenities: string[] = [];
    const keywords = [
      "wifi", "pool", "spa", "gym", "parking", "breakfast",
      "restaurant", "bar", "room service", "air conditioning",
      "beach", "balcony", "kitchen", "laundry",
    ];
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) amenities.push(kw);
    }
    return amenities.slice(0, 5);
  }

  private categorizeAttraction(text: string): string {
    const lower = text.toLowerCase();
    if (/museum|gallery|exhibit/i.test(lower)) return "museum";
    if (/park|garden|nature|hike|trail/i.test(lower)) return "nature";
    if (/temple|church|mosque|cathedral|palace|castle/i.test(lower)) return "culture";
    if (/beach|spa|resort/i.test(lower)) return "relaxation";
    if (/market|shop|mall/i.test(lower)) return "shopping";
    if (/food|restaurant|cuisine|eat/i.test(lower)) return "food";
    if (/adventure|dive|surf|climb/i.test(lower)) return "adventure";
    if (/bar|club|nightlife/i.test(lower)) return "nightlife";
    return "sightseeing";
  }

  private cleanAttractionName(title: string): string {
    return title
      .replace(/\s*[-|].+$/, "")
      .replace(/^\d+\.\s*/, "")
      .trim()
      .slice(0, 80) || "Attraction";
  }

  private estimateDuration(text: string): string {
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*hours?/i);
    if (hourMatch) return `${hourMatch[1]} hours`;
    const minMatch = text.match(/(\d+)\s*min/i);
    if (minMatch) return `${minMatch[1]} minutes`;
    return "2-3 hours";
  }

  // ─── Storage ──────────────────────────────────────────────────────────

  private async ensureStorageExists(): Promise<void> {
    try {
      await mkdir(STORAGE_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  private async loadStore(): Promise<TripStore> {
    try {
      const content = await readFile(STORAGE_FILE, "utf-8");
      return JSON.parse(content) as TripStore;
    } catch {
      return { version: 1, trips: [] };
    }
  }

  private async saveStore(store: TripStore): Promise<void> {
    await this.ensureStorageExists();
    await writeFile(STORAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
  }
}

export default TravelPlannerHandler;

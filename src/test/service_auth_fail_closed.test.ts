import assert from "node:assert/strict";
import test from "node:test";
import type { Credentials } from "../core/credentials.js";
import { CliError } from "../core/errors.js";
import { BookingSession } from "../services/booking-auth.js";
import { LibraryBookingSession } from "../services/library-booking-auth.js";
import { PmsSession } from "../services/pms-auth.js";

const credentials: Credentials = {
  sid: "12200000",
  password: "test-password",
  source: "environment",
};

test("authenticated service adapters reject unsafe requests before sending credentials", async () => {
  let bookingCalls = 0;
  const booking = new BookingSession(credentials, {
    fetchImpl: async () => {
      bookingCalls += 1;
      throw new Error("must not be called");
    },
  });
  await assert.rejects(
    () => booking.fetch("https://booking.sustech.edu.cn/api/SystemApi/AddMeeting", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "BOOKING_WRITE_BLOCKED",
  );
  assert.equal(bookingCalls, 0);

  let libraryCalls = 0;
  const library = new LibraryBookingSession(credentials, {
    fetchImpl: async () => {
      libraryCalls += 1;
      throw new Error("must not be called");
    },
  });
  await assert.rejects(
    () => library.fetch("https://booking.lib.sustech.edu.cn/ic-web/reserve/create", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_REQUEST",
  );
  assert.equal(libraryCalls, 0);

  let pmsCalls = 0;
  const pms = new PmsSession(
    { username: credentials.sid, password: credentials.password },
    {
      fetchImpl: async () => {
        pmsCalls += 1;
        throw new Error("must not be called");
      },
    },
  );
  await assert.rejects(
    () => pms.fetch("https://pms.sustech.edu.cn/api/client/PrintJob/Delete", { method: "POST" }),
    (error: unknown) => error instanceof CliError && error.code === "UNSAFE_SERVICE_URL",
  );
  assert.equal(pmsCalls, 0);
});

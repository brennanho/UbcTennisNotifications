import puppeteer from "puppeteer-core";
import AWS from "aws-sdk";
import chromium from "@sparticuz/chromium";
import NodeCache from "node-cache";

AWS.config.update({
  region: "us-east-1",
});

const SES = new AWS.SES();
const CACHE = new NodeCache({ stdTTL: 3600, checkperiod: 3600 });

const courts = [
  {
    number: 1,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=c0668c1c-1fd6-4432-a20e-4c50aaad5baa",
  },
  {
    number: 2,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=e2d99dda-cdc4-4af4-8df6-6c8061ffd56f",
  },
  {
    number: 3,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=c117a102-0ba0-4aa8-b8cf-eb8a1480be55",
  },
  {
    number: 4,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=47f78e62-2ac0-4d39-8ffa-5d331f60e14e",
  },
  {
    number: 5,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=e5432c07-c2a6-46d1-a5d7-25c58567046c",
  },
  {
    number: 6,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=f7000b6c-0d93-472b-97af-e0f22915439f",
  },
  {
    number: 7,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=5dac0879-1fbb-4dfe-ac67-5dcaa925d2f5",
  },
  {
    number: 8,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=ccbf3aa0-f263-44eb-b394-a603115f587a",
  },
  {
    number: 10,
    url: "https://ubc.perfectmind.com/24063/Clients/BookMe4LandingPages/Facility?facilityId=d5894b7a-2b61-4345-a1a8-ea8a50c921ae",
  },
];

export const handler = async (event = {}) => {
  let browser = null;
  try {
    const args = [
      ...new Set([
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--single-process",
        "--disable-dev-shm-usage",
      ]),
    ];
    console.log("Launching browser with chromium args: ", args);

    browser = await puppeteer.launch({
      headless: chromium.headless,
      args: args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
    });
    console.log("Browser launched successfully");

    const page = await browser.newPage();
    console.log("New page opened");

    const allBookings = {};
    console.log("Starting to fetch court bookings");

    for (const court of courts) {
      console.log(`Fetching court #${court.number} bookings from: ${court.url}`);

      await page.goto(court.url, { timeout: 60000 });
      console.log(`Successfully navigated to court #${court.number} URL`);

      await page.waitForSelector(".bm-booking-block-header-day", {
        visible: true,
      });
      console.log(`Successfully waited for selector ".bm-booking-block-header-day"`);

      const days = await page.$$eval(".bm-booking-block-header-day", (els) => els.map((el) => el.textContent));
      console.log(`Days retrieved: ${days.join(", ")}`);

      const gridSpacing = ["2px", "124px", "245px", "367px", "488px"];
      const cellToDayMapping = {};
      for (let i = 0; i < days.length; i++) {
        cellToDayMapping[gridSpacing[i]] = days[i];
      }

      const availableBookings = await page.$$eval(
        "span",
        (spans, cellToDayMapping, court, gridSpacing) => {
          const bookings = spans
            .filter((span) => span.textContent.includes("Book Now"))
            .map((span) => {
              const gridCell = span.closest('[role="gridcell"]');
              return {
                time: span.getAttribute("title"),
                date: cellToDayMapping[findClosestSpacing(gridSpacing, gridCell.style.left)],
                courtUrl: court.url,
              };

              function findClosestSpacing(gridSpacing, spacing) {
                const spacingValue = parseInt(spacing, 10);
                return gridSpacing.reduce((closest, current) => {
                  const currentValue = parseInt(current, 10);
                  return Math.abs(currentValue - spacingValue) < Math.abs(parseInt(closest, 10) - spacingValue)
                    ? current
                    : closest;
                });
              }
            });
          return bookings;
        },
        cellToDayMapping,
        court,
        gridSpacing
      );
      console.log(`Court #${court.number} available bookings: ${availableBookings.length}`);

      allBookings[court.number] = availableBookings;
    }

    const time = new Date().toString();
    console.log("Finished fetching all bookings");

    const stringifiedBookings = JSON.stringify(allBookings);
    if (!areAllCourtsEmpty(allBookings) && !CACHE.get(stringifiedBookings)) {
      console.log("New bookings found, sending email");

      const params = {
        Source: process.env.SES_SOURCE_EMAIL,
        Destination: {
          ToAddresses: await fetchVerifiedEmailAddresses(),
        },
        Message: {
          Subject: { Data: `Available UBC Tennis Courts: ${time}`, Charset: "UTF-8" },
          Body: { Html: { Data: formatMessage(allBookings), Charset: "UTF-8" } },
        },
      };

      const resp = await SES.sendEmail(params).promise();
      console.log("Email sent:", resp);

      CACHE.set(stringifiedBookings, true);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Successfully sent email for court bookings.",
          bookings: allBookings,
        }),
      };
    } else {
      console.log("No new court bookings.");
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No new court bookings found.",
        }),
      };
    }
  } catch (e) {
    console.error(`Error fetching court bookings: ${e.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("Browser closed successfully.");
      } catch (e) {
        console.error("Error closing browser:", e);
      }
    }
  }
};

function formatMessage(bookingData) {
  let message = `
    <h2>Available Court Bookings</h2>
    <table border="1" cellpadding="10" style="border-collapse: collapse;">
      <thead>
        <tr>
          <th>Court #</th>
          <th>Time</th>
          <th>Date</th>
          <th>Booking Link</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (let court in bookingData) {
    const bookings = bookingData[court];
    if (bookings.length > 0) {
      bookings.forEach((booking) => {
        message += `
          <tr>
            <td>${court}</td>
            <td>${booking.time}</td>
            <td>${booking.date}</td>
            <td><a href="${booking.courtUrl}" target="_blank">Book Now</a></td>
          </tr>
        `;
      });
    }
  }

  message += `</tbody></table>`;
  return message;
}

function areAllCourtsEmpty(courts) {
  return Object.values(courts).every((bookings) => bookings.length === 0);
}

async function fetchVerifiedEmailAddresses() {
  const params = { IdentityType: "EmailAddress" };
  const data = await SES.listIdentities(params).promise();
  const verifiedEmails = data.Identities.filter(async (email) => {
    const attrs = await SES.getIdentityVerificationAttributes({ Identities: [email] }).promise();
    return attrs.VerificationAttributes[email]?.VerificationStatus === "Success";
  });
  return verifiedEmails;
}

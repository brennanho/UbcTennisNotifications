import puppeteer from "puppeteer";
import AWS from "aws-sdk";

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Access Key ID from environment variable
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Secret Access Key from environment variable
  region: "us-east-1",
});
const ses = new AWS.SES();

const browser = await puppeteer.launch();
const page = await browser.newPage();

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

await publishAvailableTennisCourts({});

async function publishAvailableTennisCourts(prevAllCourtBookings) {
  const allBookings = {};
  try {
    for (const court of courts) {
      await page.goto(court.url);

      await page.waitForSelector(".bm-booking-block-header-day", {
        visible: true,
      });
      const days = await page.$$eval(".bm-booking-block-header-day", (els) => {
        return els.map((el) => el.textContent);
      });
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
                date: cellToDayMapping[
                  findClosestSpacing(gridSpacing, gridCell.style.left)
                ],
                courtUrl: court.url,
              };

              function findClosestSpacing(gridSpacing, spacing) {
                // Convert spacing (e.g., "10px") to a number by removing the "px" suffix
                const spacingValue = parseInt(spacing, 10);

                // Find the closest spacing in gridSpacing by comparing absolute differences
                return gridSpacing.reduce((closest, current) => {
                  const currentValue = parseInt(current, 10);
                  if (
                    Math.abs(currentValue - spacingValue) <
                    Math.abs(parseInt(closest, 10) - spacingValue)
                  ) {
                    return current;
                  }
                  return closest;
                });
              }
            });
          return bookings;
        },
        cellToDayMapping,
        court,
        gridSpacing
      );
      allBookings[court.number] = availableBookings;
    }

    const newBookings = getNewBookings(prevAllCourtBookings, allBookings);
    const time = new Date().toString();

    if (!areAllCourtsEmpty(newBookings)) {
      const params = {
        Source: "brennanmho@gmail.com", // Verified sender email address
        Destination: {
          ToAddresses: await fetchVerifiedEmailAddresses(),
        },
        Message: {
          Subject: {
            Data: "Available UBC Tennis Courts: " + time,
            Charset: "UTF-8",
          },
          Body: {
            Html: {
              Data: formatMessage(newBookings),
              Charset: "UTF-8",
            },
          },
        },
      };
      const resp = await ses
        .sendEmail(params)
        .promise()
        .then((data) => data);
      console.log(resp);
    } else {
      console.log("No new court bookings for: " + time);
    }
  } catch (e) {
    console.log(e);
    console.log("Failed to get tennis courts...");
  }

  await new Promise((r) => setTimeout(r, 60000));
  await publishAvailableTennisCourts(allBookings);
}

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

  // Loop through each court and include details only if there are bookings
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

function getNewBookings(courts, nextCourts) {
  const newBookings = {};

  for (const court in nextCourts) {
    // Get the current bookings (time, date) for this court
    const currentBookings = courts[court] || [];
    const currentBookingDetails = currentBookings.map(
      (booking) => `${booking.time}-${booking.date}`
    );

    // Get the new bookings (time, date) from nextCourts
    const nextBookings = nextCourts[court] || [];
    const nextBookingDetails = nextBookings.map(
      (booking) => `${booking.time}-${booking.date}`
    );

    // Find the new time-date combinations in nextCourts that are not in courts
    const newBookingDetails = nextBookingDetails.filter(
      (detail) => !currentBookingDetails.includes(detail)
    );

    // If there are new time-date combinations for this court, add them to the result
    if (newBookingDetails.length > 0) {
      // Filter nextBookings to only include those with new time-date combinations
      newBookings[court] = nextBookings.filter((booking) =>
        newBookingDetails.includes(`${booking.time}-${booking.date}`)
      );
    }
  }

  return newBookings;
}

async function fetchVerifiedEmailAddresses(nextToken = null, allEmails = []) {
  try {
    // Step 1: List all identities (email addresses)
    const params = {
      IdentityType: "EmailAddress", // Only retrieve email addresses
      NextToken: nextToken, // Pagination token, if there is one
    };

    const data = await ses.listIdentities(params).promise();
    const identities = data.Identities;

    // Step 2: fetch the verification status of each identity
    if (identities.length > 0) {
      const verificationAttributes = await ses
        .getIdentityVerificationAttributes({ Identities: identities })
        .promise();

      // Step 3: Filter the verified email addresses
      const verifiedEmails = identities.filter((identity) => {
        const status =
          verificationAttributes.VerificationAttributes[identity]
            ?.VerificationStatus;
        return status === "Success"; // Only include verified email addresses
      });

      // Add the verified emails to the accumulator
      allEmails = allEmails.concat(verifiedEmails);
    }

    // Step 4: Handle pagination if there are more identities
    if (data.NextToken) {
      return fetchVerifiedEmailAddresses(data.NextToken, allEmails);
    }

    console.log("Verified emails: " + allEmails);
    return allEmails;
  } catch (err) {
    console.error("Error fetching verified email addresses:", err);
    throw new Error("Could not fetch verified email addresses");
  }
}

// await browser.close();

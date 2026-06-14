#  Jobnator

A complete ecosystem for automated LinkedIn job scraping. The system fetches job postings based on predefined filters, stores them in a database, and notifies the user through a mobile app via Push Notifications.

##  Tech Stack

* **Backend:** C# (.NET), Entity Framework Core
* **Web Scraping:** Microsoft Playwright
* **Database:** PostgreSQL (Neon Serverless)
* **Mobile:** React Native (Expo)

## 🚀 How to Run

You can easily set up a free PostgreSQL database on [Neon](https://neon.tech/).

1. Navigate to the backend folder:
   ```bash
   cd backend
    ```
2. Run the application by injecting your database connection string as an environment variable
  ```bash
    DATABASE_URL="Host=ep-...;Database=Jobnator;Username=...;Password=your_password;SSL Mode=VerifyFull;" dotnet run
  ```
3. Install the APK on your Android device, open the app, and point it to your API URL (you can quickly do this by scanning the ASCII QR Code generated in your backend terminal).

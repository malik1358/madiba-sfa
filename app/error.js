"use client";

export default function Error({ reset }) {
  return (
    <main className="loginPage">
      <div className="loginCard">
        <h2>Something went wrong</h2>
        <p className="moduleHint" style={{ marginTop: "12px" }}>
          The app hit a loading error. This often happens after an update — refresh to load the latest version.
        </p>
        <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "16px" }}>
          <button
            type="button"
            className="modulePrimaryButton"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            }}
          >
            Refresh page
          </button>
          <button
            type="button"
            className="moduleSecondaryButton"
            onClick={() => reset()}
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}

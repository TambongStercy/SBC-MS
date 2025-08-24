import time
import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from datetime import datetime, timedelta
import logging
import os

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class EnhancedTransactionIDScraper:
    """
    Enhanced scraper specifically for extracting transaction IDs from CinetPay payout page
    with advanced filtering capabilities for date range and status
    """

    def __init__(self, headless=False):
        self.driver = None
        self.wait = None
        self.setup_driver(headless)

        # CinetPay URLs
        self.login_url = "https://app-new.cinetpay.com/login"
        self.payout_search_url = "https://app-new.cinetpay.com/transaction/search/payout"

        # Default credentials (should be set via environment variables)
        self.email = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
        self.password = os.getenv('CINETPAY_PASSWORD', 'your_password')

    def setup_driver(self, headless=False):
        """Set up Chrome driver with optimized options"""
        chrome_options = Options()

        # Essential options for stability
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--disable-extensions")
        chrome_options.add_argument("--disable-plugins")
        chrome_options.add_argument("--window-size=1200,800")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

        if headless:
            chrome_options.add_argument("--headless")

        # Disable automation indicators
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)

        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            self.wait = WebDriverWait(self.driver, 15)
            logger.info("Chrome driver initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize Chrome driver: {str(e)}")
            raise

    def login(self):
        """Login to CinetPay dashboard"""
        try:
            logger.info("Navigating to login page...")
            self.driver.get(self.login_url)

            # Wait for and fill email
            email_field = self.wait.until(EC.presence_of_element_located((By.NAME, "email")))
            email_field.clear()
            email_field.send_keys(self.email)
            logger.info("Email entered")

            # Fill password
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(self.password)
            logger.info("Password entered")

            # Click login button
            login_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
            login_button.click()

            # Wait for successful login
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "layout-wrapper")))
            logger.info("Login successful!")

        except Exception as e:
            logger.error(f"Login failed: {str(e)}")
            raise

    def navigate_to_payout_search(self):
        """Navigate to payout transaction search page"""
        try:
            logger.info("Navigating to payout search page...")
            self.driver.get(self.payout_search_url)

            # Wait for the page to load
            self.wait.until(EC.presence_of_element_located((By.TAG_NAME, "table")))
            logger.info("Successfully navigated to payout search page")

        except Exception as e:
            logger.error(f"Failed to navigate to payout search: {str(e)}")
            raise

    def set_date_filter(self, start_date, end_date):
        """Set date range filter using JavaScript injection"""
        try:
            logger.info(f"Setting date filter: {start_date} to {end_date}")

            # First, try to find any date input fields
            date_inputs = self.driver.find_elements(By.CSS_SELECTOR, "input[type='date'], input[wire\\:model*='date']")

            if date_inputs:
                # Use traditional date inputs if available
                if len(date_inputs) >= 2:
                    date_inputs[0].clear()
                    date_inputs[0].send_keys(start_date)
                    date_inputs[1].clear()
                    date_inputs[1].send_keys(end_date)
                elif len(date_inputs) == 1:
                    # Single date range input
                    date_inputs[0].clear()
                    date_inputs[0].send_keys(f"{start_date} - {end_date}")
            else:
                # Fallback: inject date filter via JavaScript
                js_script = f"""
                // Try to set date filters programmatically
                const dateInputs = document.querySelectorAll('input[type="date"], input[wire\\\\:model*="date"]');
                if (dateInputs.length >= 2) {{
                    dateInputs[0].value = '{start_date}';
                    dateInputs[1].value = '{end_date}';
                    dateInputs[0].dispatchEvent(new Event('change', {{ bubbles: true }}));
                    dateInputs[1].dispatchEvent(new Event('change', {{ bubbles: true }}));
                }} else if (dateInputs.length === 1) {{
                    dateInputs[0].value = '{start_date} - {end_date}';
                    dateInputs[0].dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                """
                self.driver.execute_script(js_script)

            # Wait a moment for filters to apply
            time.sleep(2)
            logger.info("Date filter applied")

        except Exception as e:
            logger.warning(f"Could not set date filter: {str(e)}")

    def set_country_filter(self, country_code):
        """Set country filter"""
        try:
            logger.info(f"Setting country filter: {country_code}")

            # Debug: Print all select elements to see what's available
            all_selects = self.driver.find_elements(By.TAG_NAME, "select")
            logger.info(f"Found {len(all_selects)} select elements on page")
            for i, select_elem in enumerate(all_selects):
                select_id = select_elem.get_attribute("id")
                select_name = select_elem.get_attribute("name")
                select_wire_model = select_elem.get_attribute("wire:model")
                select_class = select_elem.get_attribute("class")
                logger.info(f"Select {i}: id='{select_id}', name='{select_name}', wire:model='{select_wire_model}', class='{select_class}'")

            # Try multiple specific selectors for the country element
            selectors = [
                "select[id='country']",
                "select[id='country'][wire\\:model*='country']",
                "select[wire\\:model*='country']",
                "select[name*='country']",
                "select.form-select",
                "select[wire\\:model.defer='country']"
            ]

            country_select = None
            for selector in selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        country_select = elements[0]
                        logger.info(f"Found country select with selector: {selector}")
                        break
                except Exception as e:
                    logger.debug(f"Selector '{selector}' failed: {str(e)}")
                    continue

            if country_select:
                select = Select(country_select)
                select.select_by_value(country_code)
                logger.info(f"Country filter set to: {country_code}")
            else:
                # Try to find by exact attributes
                for select_elem in all_selects:
                    try:
                        if (select_elem.get_attribute("id") == "country" or
                            select_elem.get_attribute("wire:model") == "country" or
                            select_elem.get_attribute("wire:model") == "defer.country" or
                            "country" in str(select_elem.get_attribute("wire:model"))):
                            select = Select(select_elem)
                            select.select_by_value(country_code)
                            logger.info(f"Country filter set to: {country_code} (found by attribute matching)")
                            country_select = select_elem
                            break
                    except Exception as e:
                        logger.debug(f"Failed to use select element: {str(e)}")
                        continue

                if not country_select:
                    logger.warning("Country select element not found with any method")

            time.sleep(1)

        except Exception as e:
            logger.warning(f"Could not set country filter: {str(e)}")

    def set_status_filter(self, status):
        """Set transaction status filter"""
        try:
            logger.info(f"Setting status filter: {status}")

            # Try to find status select element
            status_selects = self.driver.find_elements(By.CSS_SELECTOR, "select[wire\\:model*='status'], select[name*='status']")

            if status_selects:
                select = Select(status_selects[0])
                # Map status to appropriate value - use the French status that appears in the UI
                status_value = "Approuvé" if status == "success" else "REFUSED" if status == "failed" else status
                select.select_by_value(status_value)
                logger.info(f"Status filter set to: {status_value}")
            else:
                # Try to inject status filter via JavaScript
                status_value = "Approuvé" if status == "success" else "REFUSED" if status == "failed" else status
                js_script = f"""
                const statusSelects = document.querySelectorAll('select[wire\\\\:model*="status"], select[name*="status"]');
                if (statusSelects.length > 0) {{
                    statusSelects[0].value = '{status_value}';
                    statusSelects[0].dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                """
                self.driver.execute_script(js_script)

            time.sleep(1)

        except Exception as e:
            logger.warning(f"Could not set status filter: {str(e)}")

    def search_transactions(self):
        """Click the search/submit button to apply filters"""
        try:
            logger.info("Applying filters...")

            # Look for submit buttons
            submit_buttons = self.driver.find_elements(By.CSS_SELECTOR, "button[type='submit'], button[wire\\:click*='search'], button[class*='btn-primary']")

            if submit_buttons:
                submit_buttons[0].click()
                logger.info("Search button clicked")
            else:
                # Try to trigger search via Enter key on a form field
                form_fields = self.driver.find_elements(By.CSS_SELECTOR, "input, select")
                if form_fields:
                    form_fields[0].send_keys(Keys.RETURN)
                    logger.info("Search triggered via Enter key")

            # Wait for results to load
            time.sleep(3)
            logger.info("Filters applied and results loaded")

        except Exception as e:
            logger.warning(f"Could not apply filters: {str(e)}")

    def extract_transaction_ids(self, date_filter=None):
        """Extract transaction IDs from the current page with optional date filtering"""
        transaction_ids = []

        try:
            # Wait for table to be present
            self.wait.until(EC.presence_of_element_located((By.TAG_NAME, "table")))

            # Find all table rows (skip header row)
            rows = self.driver.find_elements(By.CSS_SELECTOR, "table tbody tr")

            for row in rows:
                try:
                    # Look for the transaction ID in the row
                    cells = row.find_elements(By.TAG_NAME, "td")

                    if len(cells) > 2:
                        # Extract date and transaction ID
                        date_text = cells[0].text.strip()  # Date is in first column
                        transaction_id = cells[2].text.strip()  # ID Transaction Client is in third column

                        # Skip empty or invalid IDs
                        if (transaction_id and transaction_id != "" and
                            not transaction_id.startswith("Loading")):

                            # Apply date filtering if specified
                            if date_filter:
                                start_date, end_date = date_filter
                                if not self.is_date_in_range(date_text, start_date, end_date):
                                    continue  # Skip this transaction if date is not in range

                            transaction_ids.append(transaction_id)

                except Exception as e:
                    logger.debug(f"Could not extract ID from row: {str(e)}")
                    continue

            logger.info(f"Extracted {len(transaction_ids)} transaction IDs from current page")
            return transaction_ids

        except Exception as e:
            logger.error(f"Failed to extract transaction IDs: {str(e)}")
            return []

    def is_date_in_range(self, date_text, start_date, end_date):
        """Check if a date string (DD-MM-YYYY format) is within the specified range"""
        try:
            # Parse date from DD-MM-YYYY format
            date_obj = datetime.strptime(date_text.split()[0], "%d-%m-%Y")

            # Convert start and end dates to datetime objects
            start_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_obj = datetime.strptime(end_date, "%Y-%m-%d")

            # Check if date is within range
            return start_obj <= date_obj <= end_obj

        except Exception as e:
            logger.debug(f"Could not parse date '{date_text}': {str(e)}")
            return False

    def get_pagination_info(self):
        """Get pagination information"""
        try:
            # Look for pagination elements
            pagination = self.driver.find_elements(By.CSS_SELECTOR, ".pagination, nav[aria-label*='Pagination']")

            if pagination:
                # Get current page
                current_page_elements = self.driver.find_elements(By.CSS_SELECTOR, ".page-item.active .page-link, .pagination .active")
                current_page = 1
                if current_page_elements:
                    try:
                        current_page = int(current_page_elements[0].text.strip())
                    except ValueError:
                        current_page = 1

                # Get total pages
                page_links = self.driver.find_elements(By.CSS_SELECTOR, ".page-link, .pagination a")
                total_pages = current_page
                for link in page_links:
                    try:
                        page_num = int(link.text.strip())
                        total_pages = max(total_pages, page_num)
                    except ValueError:
                        continue

                # Check if there's a next page
                next_buttons = self.driver.find_elements(By.CSS_SELECTOR, ".page-item:last-child .page-link, a[rel='next'], .pagination .next")
                has_next = len(next_buttons) > 0 and "disabled" not in next_buttons[0].get_attribute("class")

                return {
                    'current_page': current_page,
                    'total_pages': total_pages,
                    'has_next': has_next
                }
            else:
                return {'current_page': 1, 'total_pages': 1, 'has_next': False}

        except Exception as e:
            logger.warning(f"Could not get pagination info: {str(e)}")
            return {'current_page': 1, 'total_pages': 1, 'has_next': False}

    def go_to_next_page(self):
        """Navigate to the next page"""
        try:
            # Find next page button/link
            next_selectors = [
                ".pagination .page-item:last-child .page-link",
                "a[rel='next']",
                ".pagination .next .page-link",
                "button[wire\\:click*='nextPage']"
            ]

            next_button = None
            for selector in next_selectors:
                try:
                    next_button = self.driver.find_element(By.CSS_SELECTOR, selector)
                    break
                except NoSuchElementException:
                    continue

            if not next_button:
                logger.warning("No next button found")
                return False

            # Check if button is disabled
            parent = next_button.find_element(By.XPATH, "..")
            if "disabled" in parent.get_attribute("class"):
                logger.info("Next button is disabled - reached last page")
                return False

            # Scroll to and click the button
            self.driver.execute_script("arguments[0].scrollIntoView(true);", next_button)
            time.sleep(0.5)

            try:
                next_button.click()
            except Exception:
                logger.info("Regular click failed, trying JavaScript click")
                self.driver.execute_script("arguments[0].click();", next_button)

            # Wait for page to load
            time.sleep(2)
            return True

        except Exception as e:
            logger.error(f"Failed to go to next page: {str(e)}")
            return False

    def scrape_all_pages(self, max_pages=None, date_filter=None):
        """Scrape transaction IDs from all pages with optional date filtering"""
        all_transaction_ids = []
        page_count = 0

        while True:
            page_count += 1

            # Check max pages limit
            if max_pages and page_count > max_pages:
                logger.info(f"Reached maximum page limit: {max_pages}")
                break

            # Get pagination info
            pagination_info = self.get_pagination_info()
            logger.info(f"Scraping page {pagination_info['current_page']} of {pagination_info['total_pages']}")

            # Extract transaction IDs from current page with date filtering if specified
            page_ids = self.extract_transaction_ids(date_filter=date_filter)
            all_transaction_ids.extend(page_ids)

            logger.info(f"Page {page_count}: {len(page_ids)} IDs, Total: {len(all_transaction_ids)}")

            # Check if there's a next page
            if not pagination_info['has_next']:
                logger.info("Reached last page")
                break

            # Go to next page
            if not self.go_to_next_page():
                logger.info("Could not navigate to next page")
                break

            # Small delay to be respectful
            time.sleep(1)

        return all_transaction_ids

    def save_transaction_ids(self, transaction_ids, filename):
        """Save transaction IDs to a file"""
        try:
            # Create directory if it doesn't exist
            os.makedirs(os.path.dirname(filename), exist_ok=True)

            # Save as CSV
            df = pd.DataFrame({'transaction_id': transaction_ids})
            df.to_csv(filename, index=False)

            logger.info(f"Saved {len(transaction_ids)} transaction IDs to {filename}")
            return filename

        except Exception as e:
            logger.error(f"Failed to save transaction IDs: {str(e)}")
            return None

    def close(self):
        """Close the browser"""
        if self.driver:
            self.driver.quit()
            logger.info("Browser closed")

def main():
    """Main function with interactive interface"""
    print("=== Enhanced CinetPay Transaction ID Scraper ===")
    print("This script extracts ID Transaction Client from payout transactions")
    print("with date range and status filtering capabilities.\n")

    # Check credentials
    email = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
    password = os.getenv('CINETPAY_PASSWORD', 'your_password')

    if email == 'your_email@example.com' or password == 'your_password':
        print("❌ Please set your CinetPay credentials!")
        print("Set these environment variables:")
        print("export CINETPAY_EMAIL='your_actual_email@example.com'")
        print("export CINETPAY_PASSWORD='your_actual_password'")
        return

    # Get user input for filters
    print("=== Filter Configuration ===")

    # Date range
    print("\n1. Date Range:")
    print("   1. Last 7 days")
    print("   2. Last 30 days")
    print("   3. Last 90 days")
    print("   4. Custom date range")

    date_choice = input("Choose date range (1-4, default: 2): ").strip() or "2"

    if date_choice == "1":
        end_date = datetime.now()
        start_date = end_date - timedelta(days=7)
        use_date_filter = False
    elif date_choice == "3":
        end_date = datetime.now()
        start_date = end_date - timedelta(days=90)
        use_date_filter = False
    elif date_choice == "4":
        start_date_str = input("Enter start date (YYYY-MM-DD): ").strip()
        end_date_str = input("Enter end date (YYYY-MM-DD): ").strip()
        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
            use_date_filter = True  # Enable date filtering for custom ranges
        except ValueError:
            print("Invalid date format. Using default (last 30 days)")
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
            use_date_filter = False
    else:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        use_date_filter = False

    date_range = (start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"))
    print(f"Selected date range: {date_range[0]} to {date_range[1]}")
    if use_date_filter:
        print("🔍 Date filtering will be applied to extracted data")

    # Country
    print("\n2. Country:")
    print("   1. Cote d'Ivoire (CI)")
    print("   2. Cameroon (CM)")
    print("   3. Senegal (SN)")
    print("   4. Burkina Faso (BF)")
    print("   5. Togo (TG)")
    print("   6. All countries")

    country_choice = input("Choose country (1-6, default: 1): ").strip() or "1"

    if country_choice == "1":
        country_code = "CI"
        country_name = "Cote d'Ivoire"
    elif country_choice == "2":
        country_code = "CM"
        country_name = "Cameroon"
    elif country_choice == "3":
        country_code = "SN"
        country_name = "Senegal"
    elif country_choice == "4":
        country_code = "BF"
        country_name = "Burkina Faso"
    elif country_choice == "5":
        country_code = "TG"
        country_name = "Togo"
    else:
        country_code = None
        country_name = "All countries"

    if country_code:
        print(f"Selected country: {country_name} ({country_code})")
    else:
        print("Selected all countries")

    # Status
    print("\n3. Transaction Status:")
    print("   1. All transactions")
    print("   2. Successful only")
    print("   3. Failed only")

    status_choice = input("Choose status (1-3, default: 1): ").strip() or "1"

    if status_choice == "2":
        status = "success"
        status_name = "Successful only"
    elif status_choice == "3":
        status = "failed"
        status_name = "Failed only"
    else:
        status = None
        status_name = "All transactions"

    print(f"Selected status: {status_name}")

    # Max pages
    max_pages_input = input("Maximum pages to scrape (Enter for all): ").strip()
    max_pages = int(max_pages_input) if max_pages_input.isdigit() else None

    if max_pages:
        print(f"Will scrape maximum {max_pages} pages")
    else:
        print("Will scrape all available pages")

    # Headless mode
    headless_choice = input("Run in headless mode? (y/n, default: n): ").strip().lower()
    headless = headless_choice == 'y'

    print(f"\nRunning in {'headless' if headless else 'normal'} mode")

    # Confirm
    print("\n=== Configuration Summary ===")
    print(f"Date Range: {date_range[0]} to {date_range[1]}")
    print(f"Country: {country_name}")
    print(f"Status: {status_name}")
    print(f"Max Pages: {max_pages or 'All'}")
    print(f"Headless Mode: {'Yes' if headless else 'No'}")

    confirm = input("\nProceed with scraping? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Scraping cancelled.")
        return

    # Initialize scraper
    scraper = EnhancedTransactionIDScraper(headless=headless)

    try:
        # Login
        print("\n[*] Logging in...")
        scraper.login()

        # Navigate to payout search
        print("[*] Navigating to payout transactions...")
        scraper.navigate_to_payout_search()

        # Set filters
        print("[*] Setting filters...")
        scraper.set_date_filter(date_range[0], date_range[1])
        if status:
            scraper.set_status_filter(status)

        # Define date filter for both single country and all countries modes
        date_filter = date_range if use_date_filter else None

        # Handle country selection
        if country_code:
            # Single country selected
            print(f"[*] Setting country filter: {country_name} ({country_code})")
            scraper.set_country_filter(country_code)

            # Apply filters
            print("[*] Applying filters...")
            scraper.search_transactions()

            # Scrape all pages for this country
            print(f"\n[*] Starting to scrape transaction IDs for {country_name}...")
            transaction_ids = scraper.scrape_all_pages(max_pages=max_pages, date_filter=date_filter)
        else:
            # All countries selected - scrape each country individually
            print("[*] All countries selected - scraping each country individually...")
            all_transaction_ids = []
            countries_to_scrape = [
                ("CI", "Cote d'Ivoire"),
                ("CM", "Cameroon"),
                ("SN", "Senegal"),
                ("BF", "Burkina Faso"),
                ("TG", "Togo")
            ]

            for country_code_scrape, country_name_scrape in countries_to_scrape:
                print(f"\n🌍 Scraping {country_name_scrape} ({country_code_scrape})...")
                try:
                    # Navigate back to base URL to reset page parameter
                    print(f"   🔄 Resetting to base URL for {country_name_scrape}...")
                    scraper.driver.get(scraper.payout_search_url)
                    time.sleep(1)

                    scraper.set_country_filter(country_code_scrape)
                    scraper.search_transactions()

                    country_ids = scraper.scrape_all_pages(max_pages=max_pages, date_filter=date_filter)
                    all_transaction_ids.extend(country_ids)
                    print(f"   ✅ Collected {len(country_ids)} IDs from {country_name_scrape}")

                    # Small delay between countries
                    time.sleep(2)

                except Exception as e:
                    print(f"   ❌ Error scraping {country_name_scrape}: {str(e)}")
                    continue

            transaction_ids = all_transaction_ids

        # Save results
        if transaction_ids:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"scraped_data/enhanced_transaction_ids_{timestamp}.csv"

            saved_file = scraper.save_transaction_ids(transaction_ids, filename)

            print(f"\n✅ SUCCESS: Scraped {len(transaction_ids)} transaction IDs!")
            print(f"💾 Saved to: {saved_file}")
        else:
            print("\n⚠️  No transaction IDs found with the specified filters.")

    except Exception as e:
        print(f"\n❌ Error during scraping: {str(e)}")
    finally:
        print("\n[*] Closing browser...")
        scraper.close()

if __name__ == "__main__":
    main()

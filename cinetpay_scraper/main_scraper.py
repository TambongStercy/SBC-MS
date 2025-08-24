# main_scraper.py
import os
import sys
from datetime import datetime, timedelta
from config import Config
from cinetpay_scraper import CinetPayScraper

def setup_environment():
    """Create necessary directories"""
    if not os.path.exists(Config.OUTPUT_DIR):
        os.makedirs(Config.OUTPUT_DIR)
        print(f"Created output directory: {Config.OUTPUT_DIR}")

def validate_credentials():
    """Check if credentials are set"""
    if Config.EMAIL == 'your_email@example.com' or Config.PASSWORD == 'your_password':
        print("❌ Please set your CinetPay credentials!")
        print("Options:")
        print("1. Set environment variables:")
        print("   export CINETPAY_EMAIL='your_email@example.com'")
        print("   export CINETPAY_PASSWORD='your_password'")
        print("2. Edit config.py and replace the placeholder values")
        return False
    return True

def get_user_filters():
    """Get filter preferences from user"""
    print("\n=== CinetPay Transaction Scraper ===")
    print("Configure your scraping filters (press Enter for defaults):\n")
    
    filters = {}
    
    # Date range
    print("Date Range Options:")
    print("1. Last 7 days")
    print("2. Last 30 days (default)")
    print("3. Last 90 days")
    print("4. Custom date range")
    
    date_choice = input("Choose date range (1-4): ").strip()
    
    if date_choice == "1":
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        filters['date_range'] = (start_date, end_date)
    elif date_choice == "3":
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        filters['date_range'] = (start_date, end_date)
    elif date_choice == "4":
        start_date = input("Enter start date (YYYY-MM-DD): ").strip()
        end_date = input("Enter end date (YYYY-MM-DD): ").strip()
        if start_date and end_date:
            try:
                # Validate date format
                datetime.strptime(start_date, "%Y-%m-%d")
                datetime.strptime(end_date, "%Y-%m-%d")
                filters['date_range'] = (start_date, end_date)
            except ValueError:
                print("Invalid date format. Using default (last 30 days)")
                filters['date_range'] = Config.get_default_date_range()
        else:
            filters['date_range'] = Config.get_default_date_range()
    else:
        filters['date_range'] = Config.get_default_date_range()
    
    # Country
    print(f"\nAvailable countries:")
    for i, (country, code) in enumerate(Config.COUNTRY_CODES.items(), 1):
        print(f"{i:2d}. {country} ({code})")
    
    country_choice = input(f"Enter country number (default: 1 for Cote d'ivoire): ").strip()
    try:
        country_index = int(country_choice) - 1
        if 0 <= country_index < len(Config.COUNTRY_CODES):
            country_key = list(Config.COUNTRY_CODES.keys())[country_index]
            filters['country_code'] = Config.COUNTRY_CODES[country_key]
        else:
            filters['country_code'] = Config.COUNTRY_CODES['Cote d\'ivoire']
    except ValueError:
        filters['country_code'] = Config.COUNTRY_CODES['Cote d\'ivoire']
    
    # Status
    print("\nTransaction Status:")
    print("1. All transactions")
    print("2. Successful only (default)")
    print("3. Failed only")
    
    status_choice = input("Choose status (1-3): ").strip()
    if status_choice == "1":
        filters['status'] = None
    elif status_choice == "3":
        filters['status'] = "REFUSED"
    else:
        filters['status'] = "ACCEPTED"
    
    # Business
    print(f"\nBusiness Options:")
    print("1. All businesses (default)")
    for i, (business, id_val) in enumerate(Config.BUSINESS_OPTIONS.items(), 2):
        if business != 'all':
            print(f"{i}. {business.replace('_', ' ').title()}")
    
    business_choice = input("Choose business (default: 1): ").strip()
    try:
        business_index = int(business_choice) - 1
        if business_index == 0:
            filters['business'] = None
        elif 1 <= business_index < len(Config.BUSINESS_OPTIONS):
            business_key = list(Config.BUSINESS_OPTIONS.keys())[business_index]
            filters['business'] = Config.BUSINESS_OPTIONS[business_key]
        else:
            filters['business'] = None
    except ValueError:
        filters['business'] = None
    
    # Max pages
    max_pages = input("Maximum pages to scrape (Enter for all): ").strip()
    try:
        filters['max_pages'] = int(max_pages) if max_pages else None
    except ValueError:
        filters['max_pages'] = None
    
    # Headless mode
    headless_choice = input("Run in headless mode? (y/n, default: n): ").strip().lower()
    filters['headless'] = headless_choice == 'y'
    
    return filters

def display_summary(stats):
    """Display summary statistics"""
    print(f"\n=== Scraping Summary ===")
    print(f"📊 Total transactions: {stats.get('total_transactions', 0)}")
    print(f"📅 Date range: {stats.get('date_range', 'N/A')}")
    
    if 'status_breakdown' in stats:
        print(f"\n📈 Status Breakdown:")
        for status, count in stats['status_breakdown'].items():
            print(f"   {status}: {count}")
    
    if 'payment_methods' in stats:
        print(f"\n💳 Payment Methods:")
        for method, count in stats['payment_methods'].items():
            if method:  # Only show non-empty methods
                print(f"   {method}: {count}")
    
    if 'currencies' in stats:
        print(f"\n💰 Currencies:")
        for currency, count in stats['currencies'].items():
            if currency:  # Only show non-empty currencies
                print(f"   {currency}: {count}")

def main():
    """Main scraping function"""
    print("=== CinetPay Transaction Scraper ===")
    print("Starting setup...\n")
    
    # Setup environment
    setup_environment()
    
    # Validate credentials
    if not validate_credentials():
        sys.exit(1)
    
    # Get user preferences
    filters = get_user_filters()
    
    # Display configuration
    print(f"\n=== Scraping Configuration ===")
    print(f"📅 Date range: {filters['date_range'][0]} to {filters['date_range'][1]}")
    
    # Get country name
    country_name = "Unknown"
    for name, code in Config.COUNTRY_CODES.items():
        if code == filters['country_code']:
            country_name = name
            break
    print(f"🌍 Country: {country_name} ({filters['country_code']})")
    
    print(f"✅ Status: {filters['status'] or 'All'}")
    
    # Get business name
    business_name = "All businesses"
    if filters['business']:
        for name, id_val in Config.BUSINESS_OPTIONS.items():
            if id_val == filters['business']:
                business_name = name.replace('_', ' ').title()
                break
    print(f"🏢 Business: {business_name}")
    
    print(f"📄 Max pages: {filters['max_pages'] or 'All'}")
    print(f"👁️  Headless mode: {'Yes' if filters['headless'] else 'No'}")
    
    confirm = input("\nProceed with scraping? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Scraping cancelled.")
        return
    
    # Initialize scraper
    print(f"\n🚀 Initializing scraper...")
    scraper = CinetPayScraper(headless=filters['headless'])
    
    try:
        # Login
        print("🔐 Logging in...")
        scraper.login()
        
        # Navigate to transactions
        print("🧭 Navigating to transactions page...")
        scraper.navigate_to_transactions()
        
        # Set filters
        print("🔧 Setting filters...")
        scraper.set_filters(
            country_code=filters['country_code'],
            status=filters['status'],
            date_range=filters['date_range'],
            business=filters['business']
        )
        
        # Scrape data
        print("⛏️  Starting data extraction...")
        transactions = scraper.scrape_all_pages(max_pages=filters['max_pages'])
        
        if not transactions:
            print("⚠️  No transactions found with the specified filters.")
            return
        
        # Save results
        print("💾 Saving results...")
        filename = scraper.save_to_csv(transactions)
        
        # Generate and display summary
        stats = scraper.get_summary_stats(transactions)
        display_summary(stats)
        
        print(f"\n✅ Scraping completed successfully!")
        print(f"💾 Data saved to: {filename}")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Scraping interrupted by user.")
    except Exception as e:
        print(f"\n❌ Scraping failed: {str(e)}")
        print("Please check your internet connection, credentials, or try again later.")
    finally:
        print("\n🔒 Closing browser...")
        scraper.close()

def quick_scrape():
    """Quick scrape with default settings"""
    print("=== Quick Scrape (Default Settings) ===")
    
    if not validate_credentials():
        return
    
    setup_environment()
    
    print("Using default settings:")
    print("- Last 30 days")
    print("- Cote d'ivoire")
    print("- Successful transactions only")
    print("- All businesses")
    print("- All pages")
    
    confirm = input("Proceed? (y/n): ").strip().lower()
    if confirm != 'y':
        return
    
    scraper = CinetPayScraper(headless=False)
    
    try:
        scraper.login()
        scraper.navigate_to_transactions()
        scraper.set_filters(
            country_code=Config.DEFAULT_FILTERS['country_code'],
            status=Config.DEFAULT_FILTERS['status'],
            date_range=Config.DEFAULT_FILTERS['date_range']
        )
        
        transactions = scraper.scrape_all_pages()
        
        if transactions:
            filename = scraper.save_to_csv(transactions)
            stats = scraper.get_summary_stats(transactions)
            display_summary(stats)
            print(f"\n✅ Quick scrape completed! Data saved to: {filename}")
        else:
            print("⚠️  No transactions found.")
            
    except Exception as e:
        print(f"❌ Quick scrape failed: {str(e)}")
    finally:
        scraper.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        quick_scrape()
    else:
        main()
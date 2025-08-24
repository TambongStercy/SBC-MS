# main_all_countries.py
import os
import sys
from datetime import datetime, timedelta
from config import Config
from improved_cinetpay_scraper import ImprovedCinetPayScraper

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

def get_scraping_options():
    """Get scraping preferences from user"""
    print("\n=== CinetPay ALL COUNTRIES Scraper ===")
    print("This will scrape ALL countries automatically!\n")
    
    options = {}
    
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
        options['date_range'] = (start_date, end_date)
    elif date_choice == "3":
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        options['date_range'] = (start_date, end_date)
    elif date_choice == "4":
        start_date = input("Enter start date (YYYY-MM-DD): ").strip()
        end_date = input("Enter end date (YYYY-MM-DD): ").strip()
        if start_date and end_date:
            try:
                datetime.strptime(start_date, "%Y-%m-%d")
                datetime.strptime(end_date, "%Y-%m-%d")
                options['date_range'] = (start_date, end_date)
            except ValueError:
                print("Invalid date format. Using default (last 30 days)")
                options['date_range'] = Config.get_default_date_range()
        else:
            options['date_range'] = Config.get_default_date_range()
    else:
        options['date_range'] = Config.get_default_date_range()
    
    # Transaction status
    print("\nTransaction Status:")
    print("1. All transactions")
    print("2. Successful only (default)")
    print("3. Failed only")
    
    status_choice = input("Choose status (1-3): ").strip()
    if status_choice == "1":
        options['status'] = None
    elif status_choice == "3":
        options['status'] = "REFUSED"
    else:
        options['status'] = "ACCEPTED"
    
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
            options['business'] = None
        elif 1 <= business_index < len(Config.BUSINESS_OPTIONS):
            business_key = list(Config.BUSINESS_OPTIONS.keys())[business_index]
            options['business'] = Config.BUSINESS_OPTIONS[business_key]
        else:
            options['business'] = None
    except ValueError:
        options['business'] = None
    
    # Max pages per country
    max_pages = input("Maximum pages per country (Enter for all, recommended: 5-10 for testing): ").strip()
    try:
        options['max_pages_per_country'] = int(max_pages) if max_pages else None
    except ValueError:
        options['max_pages_per_country'] = None
    
    # Headless mode
    headless_choice = input("Run in headless mode? (y/n, default: n): ").strip().lower()
    options['headless'] = headless_choice == 'y'
    
    return options

def display_summary_all_countries(stats):
    """Display comprehensive summary statistics"""
    print(f"\n{'='*60}")
    print(f"                    FINAL SUMMARY")
    print(f"{'='*60}")
    print(f"📊 Total transactions: {stats.get('total_transactions', 0)}")
    
    if 'countries' in stats and stats['countries']:
        print(f"\n🌍 Transactions by Country:")
        sorted_countries = sorted(stats['countries'].items(), key=lambda x: x[1], reverse=True)
        for country, count in sorted_countries:
            print(f"   {country}: {count}")
    
    if 'status_breakdown' in stats:
        print(f"\n📈 Status Breakdown:")
        for status, count in stats['status_breakdown'].items():
            print(f"   {status}: {count}")
    
    if 'payment_methods' in stats:
        print(f"\n💳 Payment Methods:")
        sorted_methods = sorted(stats['payment_methods'].items(), key=lambda x: x[1], reverse=True)
        for method, count in sorted_methods[:10]:  # Top 10
            if method:
                print(f"   {method}: {count}")
    
    if 'currencies' in stats:
        print(f"\n💰 Currencies:")
        for currency, count in stats['currencies'].items():
            if currency:
                print(f"   {currency}: {count}")

def main():
    """Main scraping function for all countries"""
    print("=== CinetPay ALL COUNTRIES Transaction Scraper ===")
    print("This will automatically scrape ALL countries!\n")
    
    # Setup
    setup_environment()
    
    # Validate credentials
    if not validate_credentials():
        sys.exit(1)
    
    # Get options
    options = get_scraping_options()
    
    # Display configuration
    print(f"\n{'='*50}")
    print(f"            SCRAPING CONFIGURATION")
    print(f"{'='*50}")
    print(f"📅 Date range: {options['date_range'][0]} to {options['date_range'][1]}")
    print(f"✅ Status: {options['status'] or 'All'}")
    
    business_name = "All businesses"
    if options['business']:
        for name, id_val in Config.BUSINESS_OPTIONS.items():
            if id_val == options['business']:
                business_name = name.replace('_', ' ').title()
                break
    print(f"🏢 Business: {business_name}")
    
    print(f"📄 Max pages per country: {options['max_pages_per_country'] or 'All'}")
    print(f"👁️  Headless mode: {'Yes' if options['headless'] else 'No'}")
    print(f"🌍 Countries to scrape: {len(Config.COUNTRY_CODES)} countries")
    
    # Show countries list
    print(f"\nCountries that will be scraped:")
    for i, (country, code) in enumerate(Config.COUNTRY_CODES.items(), 1):
        print(f"  {i:2d}. {country.replace('_', ' ').title()} ({code})")
    
    confirm = input(f"\nThis will scrape {len(Config.COUNTRY_CODES)} countries. Proceed? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Scraping cancelled.")
        return
    
    # Initialize scraper
    print(f"\n🚀 Initializing scraper...")
    scraper = ImprovedCinetPayScraper(headless=options['headless'])
    
    try:
        # Login
        print("🔐 Logging in...")
        scraper.login()
        
        # Start scraping all countries
        print(f"\n⛏️  Starting multi-country scraping...")
        print(f"This may take a while depending on the amount of data...")
        
        start_time = datetime.now()
        
        all_transactions = scraper.scrape_all_countries(
            status=options['status'],
            date_range=options['date_range'],
            business=options['business'],
            max_pages_per_country=options['max_pages_per_country']
        )
        
        end_time = datetime.now()
        duration = end_time - start_time
        
        if not all_transactions:
            print("⚠️  No transactions found across all countries with the specified filters.")
            return
        
        # Save results
        print("💾 Saving results...")
        filename = scraper.save_to_csv(all_transactions)
        
        # Generate and display summary
        stats = scraper.get_summary_stats(all_transactions)
        display_summary_all_countries(stats)
        
        print(f"\n✅ Multi-country scraping completed!")
        print(f"⏱️  Total time: {duration}")
        print(f"💾 Data saved to: {filename}")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Scraping interrupted by user.")
    except Exception as e:
        print(f"\n❌ Scraping failed: {str(e)}")
        print("Please check your internet connection, credentials, or try again later.")
    finally:
        print("\n🔒 Closing browser...")
        scraper.close()

def quick_all_countries():
    """Quick scrape all countries with default settings"""
    print("=== Quick All Countries Scrape ===")
    
    if not validate_credentials():
        return
    
    setup_environment()
    
    print("Using default settings:")
    print("- Last 30 days")
    print("- All countries")
    print("- Successful transactions only")
    print("- All businesses")
    print("- Max 5 pages per country (for testing)")
    
    confirm = input("Proceed? (y/n): ").strip().lower()
    if confirm != 'y':
        return
    
    scraper = ImprovedCinetPayScraper(headless=False)
    
    try:
        scraper.login()
        
        all_transactions = scraper.scrape_all_countries(
            status="ACCEPTED",
            date_range=Config.get_default_date_range(),
            max_pages_per_country=5  # Limit for quick test
        )
        
        if all_transactions:
            filename = scraper.save_to_csv(all_transactions)
            stats = scraper.get_summary_stats(all_transactions)
            display_summary_all_countries(stats)
            print(f"\n✅ Quick all-countries scrape completed! Data saved to: {filename}")
        else:
            print("⚠️  No transactions found.")
            
    except Exception as e:
        print(f"❌ Quick scrape failed: {str(e)}")
    finally:
        scraper.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        quick_all_countries()
    else:
        main()
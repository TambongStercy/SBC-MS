#!/usr/bin/env python3
"""
Script to scrape all 5 required countries automatically
"""

import os
import sys
import time
from datetime import datetime, timedelta
from config import Config
from cinetpay_scraper import CinetPayScraper

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

def setup_environment():
    """Create necessary directories"""
    if not os.path.exists(Config.OUTPUT_DIR):
        os.makedirs(Config.OUTPUT_DIR)
        print(f"Created output directory: {Config.OUTPUT_DIR}")

def scrape_country(country_name, country_code, scraper, date_range):
    """Scrape transactions for a specific country"""
    print(f"\n🌍 Scraping {country_name} ({country_code})...")
    
    try:
        # Navigate to transactions page
        scraper.navigate_to_transactions()
        
        # Set filters for this country
        scraper.set_filters(
            country_code=country_code,
            status='ACCEPTED',  # Only successful transactions
            date_range=date_range
        )
        
        # Scrape data
        transactions = scraper.scrape_all_pages()
        
        if transactions:
            # Generate country-specific filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"cinetpay_{country_name.lower().replace(' ', '_').replace("'", "")}_{timestamp}.csv"
            
            # Save results
            full_path = scraper.save_to_csv(transactions, filename)
            
            if full_path:
                print(f"✅ {country_name}: {len(transactions)} transactions saved to {full_path}")
                return len(transactions)
            else:
                print(f"❌ {country_name}: Failed to save data")
                return 0
        else:
            print(f"⚠️  {country_name}: No transactions found")
            return 0
            
    except Exception as e:
        print(f"❌ {country_name}: Failed - {str(e)}")
        return 0

def main():
    """Main function to scrape all countries"""
    print("=== CinetPay Multi-Country Scraper ===")
    print("This will scrape all 5 required countries automatically\n")
    
    # Setup
    setup_environment()
    
    if not validate_credentials():
        sys.exit(1)
    
    # Configuration
    date_range = Config.get_default_date_range()
    print(f"📅 Date range: {date_range[0]} to {date_range[1]}")
    print("✅ Status: ACCEPTED (successful transactions only)")
    print("🏢 Business: All businesses")
    print("👁️  Headless mode: No (visible browser)")
    
    print(f"\nCountries to scrape:")
    for i, (country, code) in enumerate(Config.COUNTRY_CODES.items(), 1):
        print(f"{i}. {country} ({code})")
    
    confirm = input(f"\nThis will scrape {len(Config.COUNTRY_CODES)} countries. Proceed? (y/n): ").strip().lower()
    if confirm != 'y':
        print("Scraping cancelled.")
        return
    
    # Initialize scraper
    print(f"\n🚀 Initializing scraper...")
    scraper = CinetPayScraper(headless=False)
    
    try:
        # Login once
        print("🔐 Logging in...")
        scraper.login()
        
        # Scrape each country
        total_transactions = 0
        successful_countries = 0
        
        for country_name, country_code in Config.COUNTRY_CODES.items():
            country_transactions = scrape_country(country_name, country_code, scraper, date_range)
            total_transactions += country_transactions
            
            if country_transactions > 0:
                successful_countries += 1
            
            # Small delay between countries
            time.sleep(2)
        
        # Summary
        print(f"\n=== Scraping Summary ===")
        print(f"🌍 Countries processed: {len(Config.COUNTRY_CODES)}")
        print(f"✅ Successful countries: {successful_countries}")
        print(f"📊 Total transactions: {total_transactions}")
        print(f"📁 Files saved in: {Config.OUTPUT_DIR}")
        
        if successful_countries > 0:
            print(f"\n🎉 Multi-country scraping completed!")
        else:
            print(f"\n⚠️  No data was scraped from any country.")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Scraping interrupted by user.")
    except Exception as e:
        print(f"\n❌ Scraping failed: {str(e)}")
        print("Please check your internet connection, credentials, or try again later.")
    finally:
        print("\n🔒 Closing browser...")
        scraper.close()

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Demo script showing how to use the Enhanced Transaction ID Scraper
Usage: python demo_enhanced_scraper.py
"""

import os
from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper
from datetime import datetime, timedelta

def demo_basic_usage():
    """Demonstrate basic usage of the enhanced scraper"""
    print("=== Enhanced Transaction ID Scraper Demo ===")

    # Check credentials
    email = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
    password = os.getenv('CINETPAY_PASSWORD', 'your_password')

    if email == 'your_email@example.com' or password == 'your_password':
        print("⚠️  Demo mode - using placeholder credentials")
        print("Set real credentials to run actual scraping:")
        print("export CINETPAY_EMAIL='your_actual_email@example.com'")
        print("export CINETPAY_PASSWORD='your_actual_password'")
        return

    print("✅ Credentials found")
    print(f"🔐 Email: {email}")
    print(f"🔐 Password: {'*' * len(password)}")

    # Initialize scraper
    print("\n🕷️  Initializing enhanced scraper...")
    scraper = EnhancedTransactionIDScraper(headless=True)

    try:
        # Demo the different filter methods
        print("📅 Setting date filter (last 7 days)...")
        end_date = datetime.now()
        start_date = end_date - timedelta(days=7)

        scraper.set_date_filter(
            start_date.strftime("%Y-%m-%d"),
            end_date.strftime("%Y-%m-%d")
        )
        print("✅ Date filter set")

        print("\n🌍 Setting country filter (Cote d'Ivoire)...")
        scraper.set_country_filter("225")
        print("✅ Country filter set")

        print("\n✅ Setting status filter (successful only)...")
        scraper.set_status_filter("success")
        print("✅ Status filter set")

        print("\n🔍 All filters configured successfully!")
        print("The scraper is ready to:")
        print("- Login to CinetPay")
        print("- Navigate to payout transactions")
        print("- Apply date, country, and status filters")
        print("- Extract transaction IDs")
        print("- Handle pagination automatically")
        print("- Save results to CSV")

        print(f"\n📁 Results will be saved to: scraped_data/enhanced_transaction_ids_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")

    except Exception as e:
        print(f"❌ Demo error: {str(e)}")
    finally:
        print("\n🔒 Closing browser...")
        scraper.close()

def demo_programmatic_usage():
    """Show programmatic usage example"""
    print("\n=== Programmatic Usage Example ===")
    print("""
# Example code for programmatic usage:

from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper
import os

# Set your credentials
os.environ['CINETPAY_EMAIL'] = 'your_email@example.com'
os.environ['CINETPAY_PASSWORD'] = 'your_password'

# Initialize and configure
scraper = EnhancedTransactionIDScraper(headless=True)

try:
    # Login and navigate
    scraper.login()
    scraper.navigate_to_payout_search()

    # Set filters
    scraper.set_date_filter('2025-01-01', '2025-01-31')
    scraper.set_country_filter('225')  # Cote d'Ivoire
    scraper.set_status_filter('success')  # Successful only

    # Apply filters and scrape
    scraper.search_transactions()
    transaction_ids = scraper.scrape_all_pages(max_pages=10)

    # Save results
    if transaction_ids:
        filename = scraper.save_transaction_ids(transaction_ids, 'my_results.csv')
        print(f"Scraped {len(transaction_ids)} IDs to {filename}")

finally:
    scraper.close()
""")

def demo_interactive_usage():
    """Show how to use the interactive mode"""
    print("\n=== Interactive Usage ===")
    print("For interactive mode with prompts:")
    print("py enhanced_transaction_id_scraper.py")
    print("\nOr use the quick run script:")
    print("py run_enhanced_scraper.py")

    print("\nThe interactive mode will ask you to:")
    print("1. Choose date range (7 days, 30 days, 90 days, or custom)")
    print("2. Select country (Cote d'Ivoire, Cameroon, Senegal, Burkina Faso, Togo, or all)")
    print("3. Choose transaction status (all, successful, or failed)")
    print("4. Set maximum pages to scrape")
    print("5. Choose headless mode (background browser)")

def main():
    """Main demo function"""
    print("🎯 Enhanced CinetPay Transaction ID Scraper Demo")
    print("=" * 50)

    # Show basic usage
    demo_basic_usage()

    # Show programmatic usage
    demo_programmatic_usage()

    # Show interactive usage
    demo_interactive_usage()

    print("\n" + "=" * 50)
    print("✨ Demo completed!")
    print("\nTo run the actual scraper:")
    print("1. Set your CinetPay credentials as environment variables")
    print("2. Run: py enhanced_transaction_id_scraper.py")
    print("3. Follow the interactive prompts")

if __name__ == "__main__":
    main()

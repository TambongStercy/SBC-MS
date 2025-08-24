#!/usr/bin/env python3
"""
Quick script to run the Enhanced Transaction ID Scraper
Usage: python run_enhanced_scraper.py
"""

import subprocess
import sys
import os

def main():
    """Run the enhanced transaction ID scraper"""
    print("🚀 Starting Enhanced CinetPay Transaction ID Scraper...")

    # Check if we're in the right directory
    if not os.path.exists("enhanced_transaction_id_scraper.py"):
        print("❌ Error: enhanced_transaction_id_scraper.py not found!")
        print("Please run this script from the cinetpay_scraper directory")
        sys.exit(1)

    # Check if credentials are set
    email = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
    password = os.getenv('CINETPAY_PASSWORD', 'your_password')

    if email == 'your_email@example.com' or password == 'your_password':
        print("❌ Please set your CinetPay credentials!")
        print("\nSet these environment variables:")
        print("Windows:")
        print("  set CINETPAY_EMAIL=your_actual_email@example.com")
        print("  set CINETPAY_PASSWORD=your_actual_password")
        print("\nMac/Linux:")
        print("  export CINETPAY_EMAIL='your_actual_email@example.com'")
        print("  export CINETPAY_PASSWORD='your_actual_password'")
        sys.exit(1)

    print("✅ Credentials found")
    print("🔐 Email:", email)
    print("🔐 Password:", "*" * len(password))

    # Run the enhanced scraper
    try:
        print("\n🕷️  Running enhanced scraper...")
        result = subprocess.run([sys.executable, "enhanced_transaction_id_scraper.py"],
                              capture_output=False, text=True)

        if result.returncode == 0:
            print("\n✅ Scraper completed successfully!")
        else:
            print(f"\n❌ Scraper failed with exit code: {result.returncode}")

    except KeyboardInterrupt:
        print("\n\n⚠️  Scraper interrupted by user")
    except Exception as e:
        print(f"\n❌ Error running scraper: {str(e)}")

if __name__ == "__main__":
    main()

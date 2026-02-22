#!/usr/bin/env python3

import requests
import sys
import json
from datetime import datetime
import uuid

class FluentraAPITester:
    def __init__(self, base_url="https://fluentra-responsive.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.session_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.errors = []

    def log_error(self, test_name, error_msg):
        """Log an error for later reporting"""
        self.errors.append(f"{test_name}: {error_msg}")
        print(f"❌ {test_name} - {error_msg}")

    def run_test(self, name, method, endpoint, expected_status, data=None, auth_required=True):
        """Run a single API test"""
        url = f"{self.base_url}{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        if auth_required and self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {method} {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)

            print(f"   Status: {response.status_code}")
            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 200:
                        print(f"   Response: {response_data}")
                    return True, response_data
                except:
                    return True, {}
            else:
                error_msg = f"Expected {expected_status}, got {response.status_code}"
                try:
                    error_data = response.json()
                    error_msg += f" - {error_data}"
                except:
                    error_msg += f" - {response.text[:100]}"
                
                self.log_error(name, error_msg)
                return False, {}

        except requests.exceptions.Timeout:
            self.log_error(name, "Request timeout")
            return False, {}
        except requests.exceptions.ConnectionError:
            self.log_error(name, "Connection error")
            return False, {}
        except Exception as e:
            self.log_error(name, f"Exception: {str(e)}")
            return False, {}

    def test_auth_flow(self):
        """Test complete authentication flow"""
        print("\n🔐 Testing Authentication Flow...")
        
        # Generate unique test user
        timestamp = datetime.now().strftime('%H%M%S')
        test_email = f"test_user_{timestamp}@example.com"
        test_password = "TestPass123!"
        test_name = f"Test User {timestamp}"

        # Test registration
        success, response = self.run_test(
            "Register User",
            "POST",
            "/api/auth/register",
            200,
            data={"name": test_name, "email": test_email, "password": test_password},
            auth_required=False
        )
        
        if success and 'token' in response and 'user' in response:
            self.token = response['token']
            self.user_id = response['user']['id']
            print(f"   Token obtained: {self.token[:20]}...")
        else:
            return False

        # Test login
        success, response = self.run_test(
            "Login User",
            "POST", 
            "/api/auth/login",
            200,
            data={"email": test_email, "password": test_password},
            auth_required=False
        )

        if not success:
            return False

        # Test get current user
        success, user_data = self.run_test(
            "Get Current User",
            "GET",
            "/api/auth/me",
            200
        )
        
        return success

    def test_onboarding(self):
        """Test user onboarding"""
        print("\n📚 Testing Onboarding...")
        
        success, response = self.run_test(
            "Onboard User",
            "PUT",
            "/api/users/onboard",
            200,
            data={
                "native_language": "Spanish",
                "target_cefr_level": "B2",
                "learning_goals": ["speaking", "business"],
                "sessions_per_week": 4
            }
        )
        return success

    def test_sessions(self):
        """Test session management"""
        print("\n🎯 Testing Sessions...")
        
        # Create session
        success, response = self.run_test(
            "Create Session",
            "POST",
            "/api/sessions",
            200,
            data={"session_type": "speaking", "plan_id": None}
        )
        
        if success and 'id' in response:
            self.session_id = response['id']
            
            # Get sessions list
            success, _ = self.run_test(
                "List Sessions",
                "GET",
                "/api/sessions",
                200
            )
            
            if success:
                # Get specific session
                success, _ = self.run_test(
                    "Get Session",
                    "GET", 
                    f"/api/sessions/{self.session_id}",
                    200
                )
                
                if success:
                    # Complete session
                    success, _ = self.run_test(
                        "Complete Session",
                        "PUT",
                        f"/api/sessions/{self.session_id}/complete",
                        200,
                        data={
                            "metrics": {"grammar_accuracy": 85, "fluency_wpm": 120, "overall_score": 78},
                            "transcript": [
                                {"speaker": "user", "text": "Hello, how are you?"},
                                {"speaker": "ai", "text": "I'm doing well, thank you!"}
                            ]
                        }
                    )
        
        return success

    def test_learning_plan(self):
        """Test learning plan functionality"""
        print("\n📋 Testing Learning Plan...")
        
        # Generate learning plan
        success, response = self.run_test(
            "Generate Learning Plan",
            "POST",
            "/api/learning-plan/generate",
            200
        )
        
        if success:
            # Get learning plan
            success, _ = self.run_test(
                "Get Learning Plan",
                "GET",
                "/api/learning-plan",
                200
            )
        
        return success

    def test_vocabulary(self):
        """Test vocabulary management"""
        print("\n📖 Testing Vocabulary...")
        
        # Add vocabulary
        success, response = self.run_test(
            "Add Vocabulary",
            "POST",
            "/api/vocabulary",
            200,
            data={
                "word": "serendipity",
                "definition": "The occurrence of events by chance in a happy way",
                "example_sentence": "Finding this job was pure serendipity.",
                "cefr_level": "C1"
            }
        )
        
        if success and 'id' in response:
            vocab_id = response['id']
            
            # Get vocabulary list
            success, _ = self.run_test(
                "Get Vocabulary List",
                "GET",
                "/api/vocabulary",
                200
            )
            
            if success:
                # Review vocabulary (spaced repetition)
                success, _ = self.run_test(
                    "Review Vocabulary",
                    "PUT",
                    f"/api/vocabulary/{vocab_id}/review",
                    200,
                    data={"quality": 4}
                )
                
                if success:
                    # Get due vocabulary
                    success, _ = self.run_test(
                        "Get Due Vocabulary",
                        "GET",
                        "/api/vocabulary/due",
                        200
                    )
        
        return success

    def test_progress(self):
        """Test progress tracking"""
        print("\n📊 Testing Progress...")
        
        success, _ = self.run_test(
            "Get Progress Data",
            "GET",
            "/api/progress",
            200
        )
        
        return success

    def test_assessment_scoring(self):
        """Test assessment scoring functionality"""
        print("\n🎓 Testing Assessment Scoring...")
        
        if self.session_id:
            success, _ = self.run_test(
                "Score Assessment",
                "POST",
                f"/api/sessions/{self.session_id}/score-assessment",
                200
            )
            return success
        else:
            print("⚠️  Skipping assessment scoring - no session ID available")
            return True

    def test_ai_session_scoring(self):
        """Test AI session scoring"""
        print("\n🤖 Testing AI Session Scoring...")
        
        if self.session_id:
            success, _ = self.run_test(
                "AI Score Session", 
                "POST",
                f"/api/ai/score-session?session_id={self.session_id}",
                200
            )
            return success
        else:
            print("⚠️  Skipping AI session scoring - no session ID available")
            return True

    def run_all_tests(self):
        """Run all API tests in sequence"""
        print("🚀 Starting Fluentra API Tests...")
        print(f"   Base URL: {self.base_url}")
        print("="*60)

        # Test basic connectivity
        try:
            response = requests.get(self.base_url, timeout=5)
            print(f"✅ Server connectivity check - Status: {response.status_code}")
        except Exception as e:
            print(f"❌ Server connectivity failed: {e}")
            return False

        # Run tests in logical order
        tests = [
            ("Authentication Flow", self.test_auth_flow),
            ("Onboarding", self.test_onboarding),
            ("Sessions Management", self.test_sessions),
            ("Learning Plan", self.test_learning_plan),
            ("Vocabulary Management", self.test_vocabulary),
            ("Progress Tracking", self.test_progress),
            ("Assessment Scoring", self.test_assessment_scoring),
            ("AI Session Scoring", self.test_ai_session_scoring),
        ]

        all_passed = True
        for test_name, test_func in tests:
            try:
                if not test_func():
                    all_passed = False
            except Exception as e:
                self.log_error(test_name, f"Test function error: {e}")
                all_passed = False

        # Print summary
        print("\n" + "="*60)
        print(f"📊 Test Summary:")
        print(f"   Tests Run: {self.tests_run}")
        print(f"   Tests Passed: {self.tests_passed}")
        print(f"   Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"   Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "   No tests run")

        if self.errors:
            print(f"\n❌ Failed Tests:")
            for error in self.errors:
                print(f"   - {error}")

        return all_passed and self.tests_run > 0

def main():
    """Main test execution"""
    tester = FluentraAPITester()
    
    success = tester.run_all_tests()
    
    # Exit with appropriate code
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
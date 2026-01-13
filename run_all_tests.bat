#!/bin/bash
# run_all_tests.sh

echo "🚀 Running all MOVA Agent tests..."

echo "📋 Testing Phase 6 (UX Stabilization)..."
node test_phase6.js
if [ $? -ne 0 ]; then
  echo "❌ Phase 6 test failed"
  exit 1
fi
echo "✅ Phase 6 test passed"

echo "📋 Testing Phase 7 (Real Scenario Integration)..."
node test_phase7_integration.js
if [ $? -ne 0 ]; then
  echo "❌ Phase 7 test failed"
  exit 1
fi
echo "✅ Phase 7 test passed"

echo ""
echo "🎉 All tests passed successfully!"
echo "✅ MOVA Agent phases 6 and 7 fully operational"
echo "✅ UX stabilization achieved"
echo "✅ Real scenario integration working"
echo "✅ Security policies enforced"
echo "✅ Evidence and episode systems functional"
echo "✅ Skill layer providing planning and explanations"
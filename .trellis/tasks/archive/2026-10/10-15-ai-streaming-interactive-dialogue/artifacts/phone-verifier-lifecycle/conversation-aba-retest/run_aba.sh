#!/system/bin/sh
rm -f /sdcard/aba_*.png /sdcard/retest_t_*.txt

echo $(date +%s%3N) > /sdcard/retest_t_send.txt
input tap 915 2055

sleep 1.0
echo $(date +%s%3N) > /sdcard/retest_t_1s.txt
screencap -p /sdcard/aba_06_generating.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_list.txt
input tap 777 234

sleep 0.4
echo $(date +%s%3N) > /sdcard/retest_t_list_ready.txt
screencap -p /sdcard/aba_07_conv_list.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_B.txt
input tap 171 1006

sleep 0.5
echo $(date +%s%3N) > /sdcard/retest_t_in_B.txt
screencap -p /sdcard/aba_08_in_conv_B.png &

sleep 2.0
echo $(date +%s%3N) > /sdcard/retest_t_leave_B.txt
input tap 777 234

sleep 0.4
echo $(date +%s%3N) > /sdcard/retest_t_list_return.txt
screencap -p /sdcard/aba_09_conv_list_return.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_A.txt
input tap 171 726

sleep 0.5
echo $(date +%s%3N) > /sdcard/retest_t_back_A.txt
screencap -p /sdcard/aba_10_back_to_conv_A.png &

sleep 3.5
echo $(date +%s%3N) > /sdcard/retest_t_quiescent.txt
screencap -p /sdcard/aba_11_conv_A_terminal_quiescent_3s.png

echo "DONE" > /sdcard/retest_status.txt

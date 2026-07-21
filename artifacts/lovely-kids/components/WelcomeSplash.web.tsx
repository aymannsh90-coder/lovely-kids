import { LinearGradient } from "expo-linear-gradient";
import React,{useEffect} from "react";
import {Image,Text,View,StyleSheet} from "react-native";

export function WelcomeSplash({onFinish}:{onFinish:()=>void}) {
  useEffect(()=>{const t=setTimeout(onFinish,3000);return()=>clearTimeout(t)},[onFinish]);
  return <View style={[StyleSheet.absoluteFill,{zIndex:9999}]}>
    <LinearGradient colors={["#E91E8C","#96DFEC"]} style={{flex:1,alignItems:"center",justifyContent:"center"}}>
      <Image source={require("@/assets/images/logo.jpg")} style={{width:132,height:132,borderRadius:66,marginBottom:24}} />
      <Text style={{fontSize:22,fontWeight:"700",color:"#fff",textAlign:"center"}}>{"أهلاً وسهلاً بكم في متجر\nLOVELY KIDS"}</Text>
    </LinearGradient>
  </View>
}
